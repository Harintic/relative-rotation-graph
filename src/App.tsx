import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsModal } from './components/SettingsModal';
import { RrgChart } from './components/RrgChart';
import { RrSidePanel } from './components/RrSidePanel';
import { SetEditorModal, type SetDraft } from './components/SetEditorModal';
import { api } from './lib/api';
import { useColumnWidths } from './lib/useColumnWidths';
import type { ApiMeta, AppSettings, DataSet, LogEntry, RrResponse, SearchResult, SetSyncResult } from './lib/types';

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function parseBounds(value: string): Bounds | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Bounds>;
    if ([parsed.minX, parsed.maxX, parsed.minY, parsed.maxY].every((item) => typeof item === 'number')) {
      return parsed as Bounds;
    }
  } catch {
    // ignore parse failures
  }
  return null;
}

function serializeBounds(bounds: Bounds | null): string {
  return bounds ? JSON.stringify(bounds) : '';
}

const defaultSettings: AppSettings = {
  search: '',
  exchange: '',
  symbol: '',
  interval: 'Daily',
  bars: '5000',
  theme: 'dark',
  outputMode: 'browser',
  saveFolder: '',
  username: '',
  password: '',
  selectedSourceExchange: '',
  selectedBaseSymbol: '',
  selectedContractSymbol: '',
  rr_selected_set_id: '',
  rr_benchmark_asset_id: '',
  rr_lookback_days: '10',
  rr_anchor_date: '',
  rr_missing_mode: 'skip',
  rr_latest_point_size: '6',
  rr_other_point_size: '3',
  rr_included_asset_ids: null,
  rr_panel_open: false,
  rr_highlighted_asset_id: '',
  rr_fixed_graph: false,
  rr_fixed_bounds: '',
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [contractOptions, setContractOptions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState('Ready');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'download' | 'sets' | 'rr' | 'logs'>('download');
  const [resolvedText, setResolvedText] = useState('Select a row to resolve the download symbol.');
  const [sets, setSets] = useState<DataSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [setEditorOpen, setSetEditorOpen] = useState(false);
  const [setDraft, setSetDraft] = useState<SetDraft | null>(null);
  const [syncResultsBySetId, setSyncResultsBySetId] = useState<Record<string, SetSyncResult>>({});
  const [expandedSyncCells, setExpandedSyncCells] = useState<Record<string, { success: boolean; failed: boolean }>>({});
  const [syncingSet, setSyncingSet] = useState<{ setId: string; action: 'download' | 'update' | 'retry-failed' } | null>(null);
  const [retryingAssetIds, setRetryingAssetIds] = useState<string[]>([]);
  const [setsStatus, setSetsStatus] = useState('');
  const [rrSelectedSetId, setRrSelectedSetId] = useState('');
  const [rrBenchmarkAssetId, setRrBenchmarkAssetId] = useState('');
  const [rrLookbackDays, setRrLookbackDays] = useState('10');
  const [rrAnchorDate, setRrAnchorDate] = useState('');
  const [rrMissingMode, setRrMissingMode] = useState<'skip' | 'ffill'>('skip');
  const [rrLatestPointSize, setRrLatestPointSize] = useState('6');
  const [rrOtherPointSize, setRrOtherPointSize] = useState('3');
  const [rrIncludedAssetIds, setRrIncludedAssetIds] = useState<string[] | null>(null);
  const [rrPanelOpen, setRrPanelOpen] = useState(false);
  const [rrFixedGraph, setRrFixedGraph] = useState(false);
  const [rrVisibleBounds, setRrVisibleBounds] = useState<Bounds | null>(null);
  const [rrFixedBounds, setRrFixedBounds] = useState<Bounds | null>(null);
  const [rrHoveredAssetId, setRrHoveredAssetId] = useState('');
  const [rrHighlightedAssetId, setRrHighlightedAssetId] = useState('');
  const [rrLoading, setRrLoading] = useState(false);
  const [rrStatus, setRrStatus] = useState('');
  const [rrResult, setRrResult] = useState<RrResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsCursor, setLogsCursor] = useState(0);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logsStatus, setLogsStatus] = useState('Connecting...');
  const [backendMeta, setBackendMeta] = useState<ApiMeta | null>(null);
  const [backendMetaError, setBackendMetaError] = useState('');
  const searchRequestId = useRef(0);
  const rrPreviousSetId = useRef('');
  const logViewRef = useRef<HTMLDivElement>(null);
  const logsCursorRef = useRef(0);
  const summaryColumns = useColumnWidths('rrg.set-summary-widths', [10, 10, 9, 9, 12, 17, 33]);

  function upsertSet(record: DataSet) {
    setSets((current) => {
      const index = current.findIndex((item) => item.id === record.id);
      if (index === -1) return [...current, record];
      const next = [...current];
      next[index] = record;
      return next;
    });
    if (selectedSetId === record.id) {
      setSelectedSetId(record.id);
    }
    if (setDraft?.id === record.id) {
      setSetDraft({
        id: record.id,
        name: record.name,
        interval: record.interval,
        bars: record.bars || settings.bars || '5000',
        benchmark_asset_id: record.benchmark_asset_id || record.assets[0]?.id || '',
        assets: record.assets.map((asset) => ({ ...asset })),
      });
    }
  }

  function setSyncCellExpanded(setId: string, cell: 'success' | 'failed', value: boolean) {
    setExpandedSyncCells((current) => ({
      ...current,
      [setId]: {
        success: cell === 'success' ? value : current[setId]?.success ?? false,
        failed: cell === 'failed' ? value : current[setId]?.failed ?? false,
      },
    }));
  }

  function toggleSyncCell(setId: string, cell: 'success' | 'failed') {
    setExpandedSyncCells((current) => ({
      ...current,
      [setId]: {
        success: cell === 'success' ? !(current[setId]?.success ?? false) : current[setId]?.success ?? false,
        failed: cell === 'failed' ? !(current[setId]?.failed ?? false) : current[setId]?.failed ?? false,
      },
    }));
  }

  function saveAppSettings(next: AppSettings) {
    setSettings(next);
    void api.saveSettings(next);
  }

  function updateRrSettings(partial: Partial<AppSettings>) {
    saveAppSettings({ ...settings, ...partial });
  }

  useEffect(() => {
    void (async () => {
      const remote = await api.loadSettings();
      setSettings((current) => ({ ...current, ...remote }));
    })();
  }, []);

  useEffect(() => {
    setRrSelectedSetId(settings.rr_selected_set_id || '');
    setRrBenchmarkAssetId(settings.rr_benchmark_asset_id || '');
    setRrLookbackDays(settings.rr_lookback_days || '10');
    setRrAnchorDate(settings.rr_anchor_date || '');
    setRrMissingMode(settings.rr_missing_mode || 'skip');
    setRrLatestPointSize(settings.rr_latest_point_size || '6');
    setRrOtherPointSize(settings.rr_other_point_size || '3');
    setRrIncludedAssetIds(settings.rr_included_asset_ids ?? null);
    setRrPanelOpen(settings.rr_panel_open ?? false);
    setRrHighlightedAssetId(settings.rr_highlighted_asset_id || '');
    setRrFixedGraph(settings.rr_fixed_graph ?? false);
    setRrFixedBounds(parseBounds(settings.rr_fixed_bounds || ''));
  }, [
    settings.rr_selected_set_id,
    settings.rr_benchmark_asset_id,
    settings.rr_lookback_days,
    settings.rr_anchor_date,
    settings.rr_missing_mode,
    settings.rr_latest_point_size,
    settings.rr_other_point_size,
    settings.rr_included_asset_ids,
    settings.rr_panel_open,
    settings.rr_highlighted_asset_id,
    settings.rr_fixed_graph,
    settings.rr_fixed_bounds,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        const meta = await api.meta();
        setBackendMeta(meta);
        setBackendMetaError('');
      } catch (error) {
        setBackendMeta(null);
        setBackendMetaError(error instanceof Error ? error.message : 'Backend meta unavailable');
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || 'dark';
  }, [settings.theme]);

  useEffect(() => {
    void (async () => {
      const response = await api.listSets();
      setSets(response.sets);
    })();
  }, []);

  useEffect(() => {
    if (!selectedSetId && sets.length) {
      setSelectedSetId(sets[0].id);
    }
    if (selectedSetId && !sets.some((item) => item.id === selectedSetId)) {
      setSelectedSetId(sets[0]?.id ?? null);
    }
  }, [sets, selectedSetId]);

  useEffect(() => {
    if (!rrSelectedSetId && sets.length) {
      setRrSelectedSetId(sets[0].id);
      updateRrSettings({ rr_selected_set_id: sets[0].id });
    }
    if (rrSelectedSetId && !sets.some((item) => item.id === rrSelectedSetId)) {
      const fallbackSetId = sets[0]?.id ?? '';
      setRrSelectedSetId(fallbackSetId);
      setRrResult(null);
      setRrStatus('');
      setRrBenchmarkAssetId('');
      setRrAnchorDate('');
      updateRrSettings({ rr_selected_set_id: fallbackSetId, rr_benchmark_asset_id: '' });
    }
  }, [sets, rrSelectedSetId]);

  useEffect(() => {
    const currentSet = sets.find((item) => item.id === rrSelectedSetId) ?? null;
    if (!currentSet) {
      setRrBenchmarkAssetId('');
      setRrIncludedAssetIds(null);
      rrPreviousSetId.current = rrSelectedSetId;
      return;
    }

    if (rrPreviousSetId.current !== rrSelectedSetId) {
      setRrIncludedAssetIds(null);
      setRrAnchorDate('');
      rrPreviousSetId.current = rrSelectedSetId;
    }

    const validIds = new Set(currentSet.assets.map((asset) => asset.id).filter((id): id is string => Boolean(id)));
    const fallback = currentSet.benchmark_asset_id || currentSet.assets[0]?.id || '';
    if (!rrBenchmarkAssetId || !validIds.has(rrBenchmarkAssetId)) {
      setRrBenchmarkAssetId(fallback);
      updateRrSettings({ rr_benchmark_asset_id: fallback });
    }
    if (rrIncludedAssetIds !== null) {
      const next = rrIncludedAssetIds.filter((id) => validIds.has(id) && id !== rrBenchmarkAssetId);
      if (next.length !== rrIncludedAssetIds.length) {
        setRrIncludedAssetIds(next);
      }
    }
  }, [sets, rrSelectedSetId, rrBenchmarkAssetId, rrIncludedAssetIds]);

  useEffect(() => {
    let cancelled = false;

    const fetchLogs = async () => {
      try {
        const response = await api.logs(logsCursorRef.current, 300);
        if (cancelled) return;
        if (response.logs.length) {
          setLogs((current) => [...current, ...response.logs].slice(-2000));
          logsCursorRef.current = response.next_id;
          setLogsCursor(response.next_id);
          setLogsStatus(`Live · ${response.logs.length} new line${response.logs.length === 1 ? '' : 's'}`);
        } else {
          logsCursorRef.current = response.next_id;
          setLogsCursor(response.next_id);
          setLogsStatus('Live');
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Logs unavailable';
        setLogsStatus(`Offline · ${message}`);
      }
    };

    void fetchLogs();
    const timer = window.setInterval(() => {
      if (!logsPaused) void fetchLogs();
    }, 750);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [logsPaused]);

  useEffect(() => {
    if (activeTab !== 'logs') return;
    const node = logViewRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [logs, activeTab]);

  useEffect(() => {
    logsCursorRef.current = logsCursor;
  }, [logsCursor]);

  useEffect(() => {
    const query = settings.search.trim();
    const exchange = settings.exchange.trim();

    if (!query) {
      setResults([]);
      setStatus('Type a query to search TradingView symbols.');
      return;
    }

    const timer = window.setTimeout(() => {
      const requestId = ++searchRequestId.current;
      setStatus(`Searching for '${query}'...`);

      void (async () => {
        try {
          const response = await api.search(query, exchange);
          if (requestId !== searchRequestId.current) return;

          setResults(response.results);
          setContractOptions([]);
          setSelectedIndex(null);
          setResolvedText('Select a row to resolve the download symbol.');
          setStatus(response.count ? `Found ${response.count} suggestions.` : `No suggestions found for '${query}'.`);
        } catch (error) {
          if (requestId !== searchRequestId.current) return;

          const message = error instanceof Error ? error.message : 'Search failed';
          setResults([]);
          setContractOptions([]);
          setSelectedIndex(null);
          setResolvedText('Select a row to resolve the download symbol.');
          setStatus(`Search failed: ${message}`);
        }
      })();
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [settings.search, settings.exchange]);

  const selectedResult = useMemo(() => {
    if (selectedIndex == null) return null;
    return results[selectedIndex] ?? null;
  }, [results, selectedIndex]);

  const selectedSet = useMemo(() => sets.find((item) => item.id === selectedSetId) ?? null, [sets, selectedSetId]);
  const rrSelectedSet = useMemo(() => sets.find((item) => item.id === rrSelectedSetId) ?? null, [sets, rrSelectedSetId]);
  const rrBenchmarkAsset = useMemo(
    () => rrSelectedSet?.assets.find((asset) => asset.id === rrBenchmarkAssetId) ?? rrSelectedSet?.assets[0] ?? null,
    [rrSelectedSet, rrBenchmarkAssetId],
  );
  const rrPlottedAssetIds = useMemo(() => {
    const benchmarkId = rrBenchmarkAssetId || rrSelectedSet?.benchmark_asset_id || rrSelectedSet?.assets[0]?.id || '';
    const validIds = new Set(rrSelectedSet?.assets.map((asset) => asset.id).filter((id): id is string => Boolean(id) && id !== benchmarkId) ?? []);
    if (rrIncludedAssetIds === null) return [...validIds];
    return rrIncludedAssetIds.filter((id) => validIds.has(id) && id !== benchmarkId);
  }, [rrIncludedAssetIds, rrSelectedSet, rrBenchmarkAssetId]);
  const rrBenchmarkDateKeys = useMemo(() => rrResult?.benchmark_dates.map((date) => date.slice(0, 10)) ?? [], [rrResult]);
  const rrResolvedAnchorDate = useMemo(() => {
    if (!rrBenchmarkDateKeys.length) return '';
    const targetKey = (rrAnchorDate || rrBenchmarkDateKeys[rrBenchmarkDateKeys.length - 1]).slice(0, 10);
    let resolved = rrBenchmarkDateKeys[0];
    for (const dateKey of rrBenchmarkDateKeys) {
      if (dateKey <= targetKey) {
        resolved = dateKey;
      } else {
        break;
      }
    }
    return resolved;
  }, [rrAnchorDate, rrBenchmarkDateKeys]);
  const rrDisplayAnchorDate = rrResolvedAnchorDate || rrAnchorDate || rrBenchmarkDateKeys[rrBenchmarkDateKeys.length - 1] || '';
  const rrVisibleResult = useMemo(() => {
    if (!rrResult) return null;
    const benchmarkDates = rrBenchmarkDateKeys;
    const lookback = Math.max(1, Number(rrLookbackDays) || rrResult.lookback_days || 10);
    const anchorIndex = benchmarkDates.indexOf(rrResolvedAnchorDate || benchmarkDates[benchmarkDates.length - 1] || '');
    const endIndex = anchorIndex >= 0 ? anchorIndex : benchmarkDates.length - 1;
    const startIndex = Math.max(0, endIndex - lookback + 1);
    const windowDates = benchmarkDates.slice(startIndex, endIndex + 1);
    const included = rrIncludedAssetIds === null ? null : new Set(rrPlottedAssetIds);
    return {
      ...rrResult,
      benchmark_dates: windowDates,
      series: rrResult.series
        .filter((series) => (included ? included.has(series.asset_id) : true))
        .map((series) => {
          const tail = series.tail.filter((point) => windowDates.includes(point.date.slice(0, 10)));
          return {
            ...series,
            tail,
            latest: tail.length ? tail[tail.length - 1] : null,
          };
        })
        .filter((series) => series.tail.length > 0),
    };
  }, [rrResult, rrBenchmarkDateKeys, rrResolvedAnchorDate, rrIncludedAssetIds, rrPlottedAssetIds, rrLookbackDays]);
  const rrChartSeriesIds = useMemo(() => rrResult?.series.map((series) => series.asset_id) ?? [], [rrResult]);
  const rrLegendAssets = useMemo(() => {
    const selected = rrSelectedSet?.assets ?? [];
    const benchmarkId = rrBenchmarkAssetId || rrSelectedSet?.benchmark_asset_id || rrSelectedSet?.assets[0]?.id || '';
    return selected
      .filter((asset): asset is (typeof asset & { id: string }) => Boolean(asset.id))
      .map((asset) => ({
        id: asset.id,
        label: asset.symbol || asset.selectedBaseSymbol || asset.selectedContractSymbol || 'Asset',
        visible: asset.id === benchmarkId || rrIncludedAssetIds === null || rrIncludedAssetIds.includes(asset.id),
        latest: rrResult?.series.find((series) => series.asset_id === asset.id)?.latest ?? null,
      }))
      ;
  }, [rrSelectedSet, rrBenchmarkAssetId, rrIncludedAssetIds]);

  const rrActiveAssetId = rrHoveredAssetId || rrHighlightedAssetId;

  const handleRrViewBoundsChange = useCallback((bounds: Bounds) => {
    setRrVisibleBounds((current) => {
      if (
        current &&
        current.minX === bounds.minX &&
        current.maxX === bounds.maxX &&
        current.minY === bounds.minY &&
        current.maxY === bounds.maxY
      ) {
        return current;
      }
      return bounds;
    });
  }, []);

  function toggleRrAsset(assetId: string) {
    const benchmarkId = rrBenchmarkAssetId || rrSelectedSet?.benchmark_asset_id || rrSelectedSet?.assets[0]?.id || '';
    if (assetId === benchmarkId) return;

    const allNonBenchmark = rrSelectedSet?.assets.map((asset) => asset.id).filter((id): id is string => Boolean(id) && id !== benchmarkId) ?? [];
    const next = (() => {
      const current = rrIncludedAssetIds;
      if (current === null) {
        return allNonBenchmark.filter((id) => id !== assetId);
      }
      return current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId];
    })();
    setRrIncludedAssetIds(next);
    updateRrSettings({ rr_included_asset_ids: next });
  }

  function showAllRrAssets() {
    setRrIncludedAssetIds(null);
    updateRrSettings({ rr_included_asset_ids: null });
  }

  function hideAllRrAssets() {
    setRrIncludedAssetIds([]);
    updateRrSettings({ rr_included_asset_ids: [] });
  }

  function toggleFixedGraph(enabled: boolean) {
    const nextBounds = enabled ? rrVisibleBounds || rrFixedBounds : rrFixedBounds;
    setRrFixedGraph(enabled);
    updateRrSettings({ rr_fixed_graph: enabled, rr_fixed_bounds: serializeBounds(nextBounds) });
    if (enabled && nextBounds) {
      setRrFixedBounds(nextBounds);
    }
  }

  useEffect(() => {
    if (!rrFixedGraph || rrFixedBounds || !rrVisibleBounds) return;
    setRrFixedBounds(rrVisibleBounds);
    updateRrSettings({ rr_fixed_bounds: serializeBounds(rrVisibleBounds) });
  }, [rrFixedGraph, rrFixedBounds, rrVisibleBounds]);

  function toggleRrHighlight(assetId: string) {
    setRrHighlightedAssetId((current) => {
      const next = current === assetId ? '' : assetId;
      updateRrSettings({ rr_highlighted_asset_id: next });
      return next;
    });
  }

  function stepRrAnchor(delta: number) {
    if (!rrBenchmarkDateKeys.length) return;
    const current = rrDisplayAnchorDate || rrBenchmarkDateKeys[rrBenchmarkDateKeys.length - 1];
    const index = rrBenchmarkDateKeys.indexOf(current);
    const fallbackIndex = rrBenchmarkDateKeys.length - 1;
    const nextIndex = Math.max(0, Math.min(rrBenchmarkDateKeys.length - 1, (index >= 0 ? index : fallbackIndex) + delta));
    const nextDate = rrBenchmarkDateKeys[nextIndex];
    setRrAnchorDate(nextDate);
    updateRrSettings({ rr_anchor_date: nextDate });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (activeTab !== 'rr') return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable) {
          return;
        }
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepRrAnchor(-1);
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepRrAnchor(1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, rrBenchmarkDateKeys, rrDisplayAnchorDate]);

  useEffect(() => {
    if (!rrBenchmarkDateKeys.length) {
      setRrAnchorDate('');
      return;
    }

    if (!rrAnchorDate) {
      setRrAnchorDate(rrBenchmarkDateKeys[rrBenchmarkDateKeys.length - 1]);
    }
  }, [rrAnchorDate, rrBenchmarkDateKeys]);

  async function download() {
    if (!settings.symbol.trim()) {
      setStatus('Select a symbol before downloading.');
      return;
    }
    try {
      setStatus('Downloading data...');
      const response = await api.download(settings);
      if (settings.outputMode === 'folder' && response.savedPath) {
        setStatus(`Saved ${response.rows} rows to ${response.savedPath}`);
        return;
      }
      if (response.csv) {
        const blob = new Blob([response.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${settings.selectedContractSymbol || settings.symbol || 'output'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setStatus(`Saved ${response.rows} rows${response.savedPath ? ` and exported to ${response.savedPath}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      setStatus(`Download failed: ${message}`);
    }
  }

  async function selectResult(item: SearchResult, index: number) {
    setSelectedIndex(index);
    const selectedBaseSymbol = item.symbol ?? '';
    const selectedSourceExchange = String(item.source_id || item.exchange || '');
    const options = (item.contracts ?? [])
      .map((contract) => contract.symbol ?? '')
      .filter((symbol): symbol is string => Boolean(symbol));
    const preferredContract = options.find((symbol) => symbol.endsWith('1!')) ?? options[0] ?? '';

    setContractOptions(options);
    setSettings((current) => ({
      ...current,
      symbol: selectedBaseSymbol,
      exchange: selectedSourceExchange,
      selectedBaseSymbol,
      selectedSourceExchange,
      selectedContractSymbol: preferredContract,
    }));
    if (selectedBaseSymbol && selectedSourceExchange) {
      try {
        const resolved = await api.resolve(selectedBaseSymbol, selectedSourceExchange, preferredContract);
        setResolvedText(resolved.resolved);
      } catch {
        setResolvedText('Resolve failed. Check the selected symbol.');
      }
    } else {
      setResolvedText('Select a symbol to resolve the download symbol.');
    }
  }

  function openNewSet() {
    setSetDraft({ name: '', interval: settings.interval || 'Daily', bars: settings.bars || '5000', benchmark_asset_id: '', assets: [] });
    setSetEditorOpen(true);
  }

  function openEditSet(item: DataSet) {
    setSetDraft({
      id: item.id,
      name: item.name,
      interval: item.interval,
      bars: item.bars || settings.bars || '5000',
      benchmark_asset_id: item.benchmark_asset_id || item.assets[0]?.id || '',
      assets: item.assets.map((asset) => ({ ...asset })),
    });
    setSetEditorOpen(true);
  }

  async function saveSet(draft: SetDraft) {
    const payload = {
      name: draft.name.trim(),
      interval: draft.interval.trim() || 'Daily',
      bars: draft.bars.trim() || '5000',
      benchmark_asset_id: draft.benchmark_asset_id || draft.assets[0]?.id || '',
      assets: draft.assets.map((asset) => ({ ...asset })),
    };

    try {
      setStatus(draft.id ? 'Updating set...' : 'Creating set...');
      if (draft.id) {
        await api.updateSet(draft.id, payload);
      } else {
        await api.createSet(payload);
      }
      const response = await api.listSets();
      setSets(response.sets);
      setStatus(draft.id ? 'Set updated.' : 'Set created.');
      setSetEditorOpen(false);
      setSetDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      setStatus(`Set save failed: ${message}`);
      throw error;
    }
  }

  async function removeSet(id: string) {
    if (!window.confirm('Delete this set?')) return;
    try {
      setStatus('Deleting set...');
      await api.deleteSet(id);
      const response = await api.listSets();
      setSets(response.sets);
      if (selectedSetId === id) {
        setSelectedSetId(response.sets[0]?.id ?? null);
      }
      setStatus('Set deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      setStatus(`Delete failed: ${message}`);
    }
  }

  async function duplicateSet(id: string) {
    try {
      setSetsStatus('Duplicating set...');
      const duplicate = await api.duplicateSet(id);
      const response = await api.listSets();
      setSets(response.sets);
      setSelectedSetId(duplicate.set.id);
      setSetsStatus('Set duplicated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Duplicate failed';
      setSetsStatus(`Set duplicate failed: ${message}`);
    }
  }

  async function syncSet(id: string, action: 'download' | 'update' | 'retry-failed', assetIds?: string[]) {
    const retryIds = assetIds || [];
    try {
      if (action === 'retry-failed' && !backendMeta?.features?.retry_failed) {
        throw new Error('Backend outdated. Restart app/backend to enable retry.');
      }
      setSyncingSet({ setId: id, action });
      if (action === 'retry-failed') {
        setRetryingAssetIds(retryIds);
      }
      const message = action === 'download' ? 'Downloading set...' : action === 'update' ? 'Updating set...' : 'Retrying failed assets...';
      setStatus(message);
      setSetsStatus(message);
      const response =
        action === 'download'
          ? await api.downloadSet(id)
          : action === 'update'
            ? await api.updateSetData(id)
            : await api.retryFailedSet(id, retryIds);
      setSyncResultsBySetId((current) => ({ ...current, [id]: response }));
      setExpandedSyncCells((current) => ({
        ...current,
        [id]: { success: false, failed: false },
      }));
      upsertSet(response.set);
      setStatus(`${response.set.name}: ${response.success}/${response.total} assets saved${response.failed ? `, ${response.failed} failed` : ''}`);
      setSetsStatus(`${response.set.name}: ${response.success}/${response.total} assets saved${response.failed ? `, ${response.failed} failed` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${action} failed`;
      setStatus(`${action} failed: ${message}`);
      setSetsStatus(`${action} failed: ${message}`);
    }
    finally {
      setSyncingSet((current) => (current?.setId === id ? null : current));
      setRetryingAssetIds([]);
    }
  }

  async function clearLogs() {
    await api.clearLogs();
    setLogs([]);
    setLogsCursor(0);
    logsCursorRef.current = 0;
    setLogsStatus('Cleared');
  }

  async function createRrg() {
    if (!rrSelectedSetId) {
      setRrStatus('Select a set first.');
      return;
    }
    try {
      setRrLoading(true);
      setRrStatus('Creating relative rotation graph...');
      const response = await api.createRrg(rrSelectedSetId, {
        benchmarkAssetId: rrBenchmarkAssetId,
        lookbackDays: Number(rrLookbackDays) || 10,
        includedAssetIds: rrSelectedSet?.assets.map((asset) => asset.id).filter((id): id is string => Boolean(id)) ?? [],
        missingMode: rrMissingMode,
      });
      setRrResult(response);
      setRrStatus(`Chart created for ${response.set.name}. Benchmark: ${response.benchmark_label}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed';
      setRrStatus(`Create failed: ${message}`);
      setRrResult(null);
    } finally {
      setRrLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>TradingView Data Downloader</h1>
          <p>Local Tauri app with Python sidecar</p>
        </div>
        <div className="topbar-actions">
          <div className="tab-switcher">
            <button className={activeTab === 'download' ? 'selected' : ''} onClick={() => setActiveTab('download')}>
              Download
            </button>
            <button className={activeTab === 'sets' ? 'selected' : ''} onClick={() => setActiveTab('sets')}>
              Sets
            </button>
            <button className={activeTab === 'rr' ? 'selected' : ''} onClick={() => setActiveTab('rr')}>
              RR
            </button>
            <button className={activeTab === 'logs' ? 'selected' : ''} onClick={() => setActiveTab('logs')}>
              Logs
            </button>
          </div>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>

      {activeTab === 'download' ? (
        <>
          <section className="panel grid-2">
            <label>
              Search
              <input value={settings.search} onChange={(e) => setSettings({ ...settings, search: e.target.value })} />
            </label>
            <label>
              Exchange
              <input value={settings.exchange} onChange={(e) => setSettings({ ...settings, exchange: e.target.value })} />
            </label>
          </section>

          <section className="panel suggestions-panel">
            <div className="panel-title">Suggestions</div>
            <div className="results-table-wrap">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>Exchange</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((item, index) => (
                    <tr
                      key={`${item.symbol}-${index}`}
                      className={selectedIndex === index ? 'selected' : ''}
                      onClick={() => void selectResult(item, index)}
                    >
                      <td>{item.symbol}</td>
                      <td>{item.name || item.description || item.shortname || ''}</td>
                      <td>{item.source_id || item.exchange || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel grid-2">
            <label>
              Symbol
              <input value={settings.symbol} onChange={(e) => setSettings({ ...settings, symbol: e.target.value })} />
            </label>
            <label>
              Interval
              <input value={settings.interval} onChange={(e) => setSettings({ ...settings, interval: e.target.value })} />
            </label>
            <label>
              Bars
              <input value={settings.bars} onChange={(e) => setSettings({ ...settings, bars: e.target.value })} />
            </label>
            <label>
              Contract
              <select
                value={settings.selectedContractSymbol}
                onChange={(e) => setSettings({ ...settings, selectedContractSymbol: e.target.value })}
                disabled={!contractOptions.length}
              >
                <option value="">{contractOptions.length ? 'Select a contract' : 'No contracts available'}</option>
                {contractOptions.map((contract) => (
                  <option key={contract} value={contract}>
                    {contract}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Username
              <input value={settings.username} onChange={(e) => setSettings({ ...settings, username: e.target.value })} />
            </label>
            <label>
              Password
              <input type="password" value={settings.password} onChange={(e) => setSettings({ ...settings, password: e.target.value })} />
            </label>
          </section>

          <section className="panel actions">
            <button onClick={download}>Download</button>
            <div className="status">{status}</div>
          </section>
        </>
      ) : null}

      {activeTab === 'sets' ? (
        <section className="panel sets-panel">
          <div className="panel-head">
            <div className="panel-title">Sets</div>
            <button onClick={openNewSet}>New set</button>
          </div>
          {backendMetaError ? <div className="sets-inline-status">{backendMetaError}</div> : null}
          {setsStatus ? <div className="sets-inline-status">{setsStatus}</div> : null}
          <div className="sets-layout">
            <div className="sets-list">
              {sets.map((item) => (
                <button key={item.id} className={`set-item ${selectedSetId === item.id ? 'selected' : ''}`} onClick={() => setSelectedSetId(item.id)}>
                  <strong>{item.name}</strong>
                  <span>{item.interval} · {item.assets.length} assets</span>
                </button>
              ))}
              {!sets.length ? <div className="empty-state">No sets yet.</div> : null}
            </div>

            <div className="set-details">
              {selectedSet ? (
                <>
                  <div className="set-details-header">
                    <div>
                      <h3>{selectedSet.name}</h3>
                      <p>
                        {selectedSet.interval} · bars {selectedSet.bars || settings.bars || '5000'} · benchmark{' '}
                        {selectedSet.assets.find((asset) => asset.id === selectedSet.benchmark_asset_id)?.symbol || selectedSet.assets[0]?.symbol || '-'} · folder `Output/{selectedSet.folder_name}`
                      </p>
                    </div>
                    <div className="set-actions">
                      <button disabled={!!syncingSet && syncingSet.setId === selectedSet.id} onClick={() => openEditSet(selectedSet)}>
                        Edit
                      </button>
                      <button disabled={!!syncingSet && syncingSet.setId === selectedSet.id} onClick={() => void duplicateSet(selectedSet.id)}>
                        Duplicate
                      </button>
                      <button disabled={!!syncingSet && syncingSet.setId === selectedSet.id} onClick={() => void removeSet(selectedSet.id)}>
                        Delete
                      </button>
                      <button disabled={!!syncingSet && syncingSet.setId === selectedSet.id} onClick={() => void syncSet(selectedSet.id, 'download')}>
                        Download
                      </button>
                      <button disabled={!!syncingSet && syncingSet.setId === selectedSet.id} onClick={() => void syncSet(selectedSet.id, 'update')}>
                        Update
                      </button>
                      {syncResultsBySetId[selectedSet.id]?.failed && backendMeta?.features?.retry_failed ? (
                        <button
                          disabled={!!syncingSet && syncingSet.setId === selectedSet.id}
                          onClick={() =>
                            void syncSet(
                              selectedSet.id,
                              'retry-failed',
                              syncResultsBySetId[selectedSet.id].results.filter((item) => !item.ok && item.asset_id).map((item) => item.asset_id as string),
                            )
                          }
                        >
                          Retry failed ({syncResultsBySetId[selectedSet.id].failed})
                        </button>
                      ) : syncResultsBySetId[selectedSet.id]?.failed ? <span className="sets-inline-status">Backend outdated. Restart app/backend to enable retry.</span> : null}
                    </div>
                  </div>

                  {setsStatus ? <div className="set-inline-status">{setsStatus}</div> : null}

                  {syncingSet && syncingSet.setId === selectedSet.id ? (
                    <div className="sync-banner">
                      <div className="sync-banner-row">
                        <span className="sync-spinner" />
                        <span>{syncingSet.action === 'download' ? 'Downloading set...' : syncingSet.action === 'update' ? 'Updating set...' : 'Retrying failed assets...'}</span>
                      </div>
                      <div className="sync-progress indeterminate">
                        <span />
                      </div>
                    </div>
                  ) : null}

                  {syncResultsBySetId[selectedSet.id] ? (() => {
                    const result = syncResultsBySetId[selectedSet.id];
                    const successItems = result.results.filter((item) => item.ok);
                    const failedItems = result.results.filter((item) => !item.ok);
                    const expanded = expandedSyncCells[selectedSet.id] ?? { success: false, failed: false };
                    const successSummary = successItems.length ? successItems.map((item) => item.file_name).join(', ') : '-';
                    const failedSummary = failedItems.length
                      ? failedItems.map((item) => `${item.file_name}${item.error ? ` (${item.error})` : ''}`).join(', ')
                      : '-';

                    return (
                      <div className="sync-grid">
                        <div className="sync-card success-card">
                          <div className="sync-card-head">
                            <strong>Success ({successItems.length})</strong>
                            <button
                              className="sync-card-toggle"
                              aria-expanded={expanded.success}
                              onClick={() => toggleSyncCell(selectedSet.id, 'success')}
                            >
                              <span className={`sync-card-arrow ${expanded.success ? 'expanded' : ''}`}>▸</span>
                            </button>
                          </div>
                          <div className="sync-card-summary">{successSummary}</div>
                          {expanded.success ? (
                            <div className="sync-card-details">
                              {successItems.length ? successItems.map((item) => (
                                <div key={item.file_name} className="sync-detail-line ok">
                                  <span>{item.file_name}</span>
                                  <span>{item.rows} rows</span>
                                  <span>{item.resolved_exchange}:{item.resolved_symbol}</span>
                                </div>
                              )) : <div className="sync-detail-empty">No successful assets.</div>}
                            </div>
                          ) : null}
                        </div>

                        <div className="sync-card fail-card">
                          <div className="sync-card-head">
                            <strong>Failed ({failedItems.length})</strong>
                            <button
                              className="sync-card-toggle"
                              aria-expanded={expanded.failed}
                              onClick={() => toggleSyncCell(selectedSet.id, 'failed')}
                            >
                              <span className={`sync-card-arrow ${expanded.failed ? 'expanded' : ''}`}>▸</span>
                            </button>
                          </div>
                          <div className="sync-card-summary">{failedSummary}</div>
                          {expanded.failed ? (
                            <div className="sync-card-details">
                              {failedItems.length ? failedItems.map((item) => (
                                <div key={item.file_name} className="sync-detail-line fail">
                                  <span>{item.file_name}</span>
                                  <span>{item.error}</span>
                                </div>
                              )) : <div className="sync-detail-empty">No failed assets.</div>}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })() : null}

                  <div className="set-assets-summary">
                    <table className="results-table compact-table set-summary-table">
                      <thead>
                        <tr>
                          {[
                            'Symbol',
                            'Source Exchange',
                            'Contract',
                            'Bars Requested',
                            'Bars Available',
                            'File Name',
                            'Last Updated',
                          ].map((label, index, items) => (
                            <th
                              key={label}
                              title={label}
                              style={summaryColumns.getWidthStyle(index)}
                              className="resizable-th"
                            >
                              <span className="header-label">{label}</span>
                              {index < items.length - 1 ? <span className="resize-handle" onMouseDown={summaryColumns.startResize(index)} /> : null}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSet.assets.map((asset) => (
                          <tr key={asset.id ?? asset.file_name}>
                            <td>{asset.symbol || asset.selectedBaseSymbol || asset.selectedContractSymbol}</td>
                            <td>{asset.selectedSourceExchange || asset.exchange}</td>
                            <td>{asset.selectedContractSymbol}</td>
                            <td>{selectedSet.bars || settings.bars || '5000'}</td>
                            <td>{asset.available_bars ?? '-'}</td>
                            <td>{asset.file_name}</td>
                            <td>{asset.last_updated ? new Date(asset.last_updated).toLocaleString() : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="empty-state">Select a set to manage it.</div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'rr' ? (
        <section className="panel rr-panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">RElaative rotation grab</div>
              <div className="rr-subtitle">Pick a set, choose benchmark and asset filters, then build from stored CSVs.</div>
            </div>
            <div className="set-actions">
                <button
                  onClick={() => {
                    setRrPanelOpen((current) => {
                      updateRrSettings({ rr_panel_open: !current });
                      return !current;
                    });
                  }}
                  disabled={!rrSelectedSetId}
                >
                  Settings
                </button>
              <button onClick={() => void createRrg()} disabled={rrLoading || !rrSelectedSetId}>
                {rrLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>

          <div className="rr-workspace">
            <section className="panel rr-chart-panel">
              <div className="rr-chart-shell">
                <button
                  className="rr-drawer-handle"
                  onClick={() => {
                    setRrPanelOpen((current) => {
                      updateRrSettings({ rr_panel_open: !current });
                      return !current;
                    });
                  }}
                  aria-label="Toggle RR settings panel"
                >
                  {rrPanelOpen ? '▸' : '◂'}
                </button>
                <RrgChart
                  value={rrVisibleResult}
                  allSeriesIds={rrChartSeriesIds}
                  legendAssets={rrLegendAssets}
                  activeAssetId={rrActiveAssetId}
                  highlightedAssetId={rrHighlightedAssetId}
                  onAssetHover={(assetId) => setRrHoveredAssetId(assetId)}
                  onAssetHoverEnd={() => setRrHoveredAssetId('')}
                  onAssetToggle={toggleRrAsset}
                  onAssetClick={toggleRrHighlight}
                  onSelectAll={showAllRrAssets}
                  onHideAll={hideAllRrAssets}
                  fixedGraph={rrFixedGraph}
                  fixedBounds={rrFixedGraph ? rrFixedBounds : null}
                  onViewBoundsChange={handleRrViewBoundsChange}
                  latestPointSize={Number(rrLatestPointSize) || 6}
                  otherPointSize={Number(rrOtherPointSize) || 3}
                />
              </div>
            </section>

            <aside className={`rr-side-drawer ${rrPanelOpen ? 'open' : ''}`}>
              <div className="rr-side-drawer-scroll">
                <label>
                  Set
                  <select
                    value={rrSelectedSetId}
                    onChange={(e) => {
                      setRrSelectedSetId(e.target.value);
                      setRrPanelOpen(true);
                      updateRrSettings({ rr_selected_set_id: e.target.value, rr_panel_open: true });
                    }}
                  >
                    <option value="">Select a set</option>
                    {sets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rr-meta">
                  <div>{rrSelectedSet ? `Benchmark: ${rrBenchmarkAsset?.symbol || rrBenchmarkAsset?.selectedBaseSymbol || rrBenchmarkAsset?.selectedContractSymbol || '-'}` : 'Benchmark: -'}</div>
                  <div>
                    {rrLookbackDays || '10'} trading days · {rrMissingMode === 'skip' ? 'skip missing' : 'forward-fill'} · {rrPlottedAssetIds.length} plotted
                  </div>
                  <div>{rrStatus || 'Ready'}</div>
                </div>

                <RrSidePanel
                  lookbackDays={rrLookbackDays}
                  missingMode={rrMissingMode}
                  fixedGraph={rrFixedGraph}
                  onLookbackDaysChange={(value: string) => {
                    setRrLookbackDays(value);
                    updateRrSettings({ rr_lookback_days: value });
                  }}
                  onMissingModeChange={(value: 'skip' | 'ffill') => {
                    setRrMissingMode(value);
                    updateRrSettings({ rr_missing_mode: value });
                  }}
                  latestPointSize={rrLatestPointSize}
                  otherPointSize={rrOtherPointSize}
                  onLatestPointSizeChange={(value: string) => {
                    setRrLatestPointSize(value);
                    updateRrSettings({ rr_latest_point_size: value });
                  }}
                  onOtherPointSizeChange={(value: string) => {
                    setRrOtherPointSize(value);
                    updateRrSettings({ rr_other_point_size: value });
                  }}
                  onFixedGraphChange={(value: boolean) => toggleFixedGraph(value)}
                />
              </div>
            </aside>
          </div>

          <div className="rr-chart-footer panel">
            <div className="rr-chart-footer-grid">
              <label>
                Last date
                <div className="rr-anchor-row">
                  <button type="button" className="secondary-button rr-anchor-step" onClick={() => stepRrAnchor(-1)} disabled={!rrBenchmarkDateKeys.length}>
                    ◀
                  </button>
                  <input
                    type="date"
                    value={rrDisplayAnchorDate}
                    onChange={(e) => {
                      setRrAnchorDate(e.target.value);
                      updateRrSettings({ rr_anchor_date: e.target.value });
                    }}
                  />
                  <button type="button" className="secondary-button rr-anchor-step" onClick={() => stepRrAnchor(1)} disabled={!rrBenchmarkDateKeys.length}>
                    ▶
                  </button>
                </div>
              </label>
            </div>
            <div className="rr-chart-footer-note">
              <div>Using: {rrDisplayAnchorDate || '-'}</div>
              <div>{rrLookbackDays || '10'} trading days ending at the selected date.</div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'logs' ? (
        <section className="panel logs-panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Logs</div>
              <div className="logs-subtitle">Python terminal output</div>
            </div>
            <div className="set-actions">
              <button onClick={() => setLogsPaused((current) => !current)}>{logsPaused ? 'Resume' : 'Pause'}</button>
              <button onClick={() => void clearLogs()}>Clear</button>
            </div>
          </div>
          <div className="logs-status">{logsStatus}</div>
          <div className="logs-console" ref={logViewRef}>
            {logs.length ? (
              logs.map((entry) => (
                <div key={entry.id} className="log-line">
                  [{entry.ts}] {entry.source}: {entry.message}
                </div>
              ))
            ) : (
              <div className="empty-state">No logs yet.</div>
            )}
          </div>
        </section>
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          value={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            saveAppSettings({ ...settings, ...next });
            setSettingsOpen(false);
          }}
        />
      ) : null}

      {setEditorOpen && setDraft ? (
        <SetEditorModal
          value={setDraft}
          onClose={() => {
            setSetEditorOpen(false);
            setSetDraft(null);
          }}
          onSave={async (next) => {
            await saveSet(next);
          }}
        />
      ) : null}

    </div>
  );
}
