import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SettingsModal } from './components/SettingsModal';
import { SetEditorModal, type SetDraft } from './components/SetEditorModal';
import { api } from './lib/api';
import { useColumnWidths } from './lib/useColumnWidths';
import type { ApiMeta, AppSettings, DataSet, LogEntry, SearchResult, SetSyncResult } from './lib/types';

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
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [contractOptions, setContractOptions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState('Ready');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'download' | 'sets' | 'logs'>('download');
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
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsCursor, setLogsCursor] = useState(0);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logsStatus, setLogsStatus] = useState('Connecting...');
  const [backendMeta, setBackendMeta] = useState<ApiMeta | null>(null);
  const [backendMetaError, setBackendMetaError] = useState('');
  const searchRequestId = useRef(0);
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

  useEffect(() => {
    void (async () => {
      const remote = await api.loadSettings();
      setSettings((current) => ({ ...current, ...remote }));
    })();
  }, []);

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
    if (selectedBaseSymbol && selectedSourceExchange && preferredContract) {
      try {
        const resolved = await api.resolve(selectedBaseSymbol, selectedSourceExchange, preferredContract);
        setResolvedText(resolved.resolved);
      } catch {
        setResolvedText('Select a valid contract to resolve the download symbol.');
      }
    } else {
      setResolvedText('Select a valid contract to resolve the download symbol.');
    }
  }

  function openNewSet() {
    setSetDraft({ name: '', interval: settings.interval || 'Daily', bars: settings.bars || '5000', assets: [] });
    setSetEditorOpen(true);
  }

  function openEditSet(item: DataSet) {
    setSetDraft({
      id: item.id,
      name: item.name,
      interval: item.interval,
      bars: item.bars || settings.bars || '5000',
      assets: item.assets.map((asset) => ({ ...asset })),
    });
    setSetEditorOpen(true);
  }

  async function saveSet(draft: SetDraft) {
    const payload = {
      name: draft.name.trim(),
      interval: draft.interval.trim() || 'Daily',
      bars: draft.bars.trim() || '5000',
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
                      <p>{selectedSet.interval} · bars {selectedSet.bars || settings.bars || '5000'} · folder `Output/{selectedSet.folder_name}`</p>
                    </div>
                    <div className="set-actions">
                      <button disabled={!!syncingSet && syncingSet.setId === selectedSet.id} onClick={() => openEditSet(selectedSet)}>
                        Edit
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
            setSettings(next);
            void api.saveSettings(next);
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

      {activeTab === 'download' ? <footer className="footer">{selectedResult ? `Selected: ${selectedResult.symbol} | ${resolvedText}` : resolvedText}</footer> : null}
    </div>
  );
}
