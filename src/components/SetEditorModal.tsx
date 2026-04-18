import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useColumnWidths } from '../lib/useColumnWidths';
import type { SearchResult, SetAsset } from '../lib/types';

export type SetDraft = {
  id?: string;
  name: string;
  interval: string;
  bars: string;
  assets: SetAsset[];
};

type Props = {
  value: SetDraft;
  onClose: () => void;
  onSave: (value: SetDraft) => Promise<void>;
};

function sanitize(value: string) {
  return value.replace(/[^A-Za-z0-9._!/-]+/g, '_').replace(/^_+|_+$/g, '');
}

function defaultContract(contracts: Array<{ symbol?: string }> | undefined) {
  const options = (contracts ?? []).map((item) => item.symbol ?? '').filter(Boolean);
  return options.find((value) => value.endsWith('1!')) ?? options[0] ?? '';
}

function assetKey(asset: Pick<SetAsset, 'selectedSourceExchange' | 'selectedBaseSymbol' | 'symbol' | 'selectedContractSymbol'>) {
  return [asset.selectedSourceExchange || '', asset.selectedBaseSymbol || asset.symbol || '', asset.selectedContractSymbol || ''].join('|').toLowerCase();
}

function resultToAsset(result: SearchResult, query: string, exchange: string): SetAsset {
  const symbol = result.symbol ?? '';
  const sourceExchange = String(result.source_id || result.exchange || exchange || '');
  const baseSymbol = symbol;
  const contractSymbol = defaultContract(result.contracts);
  const id = crypto.randomUUID();
  const fileLabel = sanitize(contractSymbol || symbol || 'asset') || 'asset';

  return {
    id,
    search: query,
    exchange: sourceExchange,
    symbol,
    selectedSourceExchange: sourceExchange,
    selectedBaseSymbol: baseSymbol,
    selectedContractSymbol: contractSymbol,
    file_name: `${fileLabel}.csv`,
  };
}

function createBlankAsset(): SetAsset {
  return {
    id: crypto.randomUUID(),
    search: '',
    exchange: '',
    symbol: '',
    selectedSourceExchange: '',
    selectedBaseSymbol: '',
    selectedContractSymbol: '',
    file_name: '',
  };
}

export function SetEditorModal({ value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<SetDraft>(value);
  const [search, setSearch] = useState('');
  const [exchange, setExchange] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState('Type to search symbols.');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const searchRequestId = useRef(0);
  const tableColumns = useColumnWidths('rrg.set-editor-widths', [12, 12, 10, 10, 10, 17, 19, 10]);

  useEffect(() => {
    const query = search.trim();
    const srcExchange = exchange.trim();

    if (!query) {
      setResults([]);
      setSearchStatus('Type to search symbols.');
      return;
    }

    const timer = window.setTimeout(() => {
      const requestId = ++searchRequestId.current;
      setSearchStatus(`Searching for '${query}'...`);

      void (async () => {
        try {
          const response = await api.search(query, srcExchange);
          if (requestId !== searchRequestId.current) return;
          setResults(response.results);
          setSearchStatus(response.count ? `Showing ${response.results.length} of ${response.count} results.` : `No results for '${query}'.`);
        } catch (error) {
          if (requestId !== searchRequestId.current) return;
          setResults([]);
          setSearchStatus(error instanceof Error ? `Search failed: ${error.message}` : 'Search failed');
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search, exchange]);

  const duplicateKeys = useMemo(() => new Set(draft.assets.map(assetKey)), [draft.assets]);

  function addResult(result: SearchResult) {
    const asset = resultToAsset(result, search.trim(), exchange.trim());
    if (duplicateKeys.has(assetKey(asset))) return;

    setDraft((current) => ({
      ...current,
      assets: [...current.assets, asset],
    }));
  }

  function updateAsset(index: number, next: Partial<SetAsset>) {
    setDraft((current) => ({
      ...current,
      assets: current.assets.map((asset, assetIndex) => (assetIndex === index ? { ...asset, ...next } : asset)),
    }));
  }

  async function handleSave() {
    const trimmedName = draft.name.trim();
    const trimmedInterval = draft.interval.trim();
    const barsValue = Number(draft.bars);

    if (!trimmedName) {
      setSaveError('Set name is required.');
      return;
    }
    if (!trimmedInterval) {
      setSaveError('Interval is required.');
      return;
    }
    if (!Number.isFinite(barsValue) || barsValue <= 0) {
      setSaveError('Bars must be a positive number.');
      return;
    }
    if (!draft.assets.length) {
      setSaveError('Add at least one asset.');
      return;
    }

    setSaveError('');
    setIsSaving(true);
    try {
      const assets = draft.assets.map((asset) => {
        const fileName = asset.file_name?.trim() || `${(asset.selectedContractSymbol || asset.symbol || 'asset').trim()}.csv`;
        return {
          ...asset,
          selectedBaseSymbol: asset.selectedBaseSymbol || asset.symbol,
          selectedSourceExchange: asset.selectedSourceExchange || asset.exchange,
          file_name: fileName,
        };
      });
      await onSave({ ...draft, name: trimmedName, interval: trimmedInterval, bars: String(Math.floor(barsValue)), assets });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-header-row">
          <h2>{draft.id ? 'Edit set' : 'New set'}</h2>
          <div className="modal-count">Assets: {draft.assets.length}</div>
        </div>

        <div className="modal-scroll">
          <div className="set-form-grid">
            <label>
              Name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label>
              Interval
              <input value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value })} />
            </label>
            <label>
              Bars
              <input type="number" min="1" step="1" value={draft.bars} onChange={(e) => setDraft({ ...draft, bars: e.target.value })} />
            </label>
          </div>

          <div className="panel-title">Search assets</div>
          <div className="set-form-grid">
            <label>
              Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to search" />
            </label>
            <label>
              Exchange
              <input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="Optional filter" />
            </label>
          </div>

          <div className="set-results-header">{searchStatus}</div>
          <div className="results-table-wrap set-search-results">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Exchange</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((item, index) => {
                  const asset = resultToAsset(item, search.trim(), exchange.trim());
                  const added = duplicateKeys.has(assetKey(asset));
                  return (
                    <tr key={`${item.symbol}-${index}`}>
                      <td>{item.symbol}</td>
                      <td>{item.name || item.description || item.shortname || ''}</td>
                      <td>{item.source_id || item.exchange || ''}</td>
                      <td className="result-add-cell">
                        <button className="icon-button" disabled={added} onClick={() => addResult(item)}>
                          {added ? 'Added' : '+'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="panel-title">Assets in set</div>
          <div className="set-editor-actions">
            <button onClick={() => setDraft((current) => ({ ...current, assets: [...current.assets, createBlankAsset()] }))}>
              Add blank asset
            </button>
          </div>

          <div className="set-assets-list">
            <table className="results-table compact-table set-editor-table">
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
                    '',
                  ].map((label, index, items) => (
                    <th
                      key={`${label || 'actions'}-${index}`}
                      title={label || 'Actions'}
                      style={tableColumns.getWidthStyle(index)}
                      className="resizable-th"
                    >
                      {label ? <span className="header-label">{label}</span> : null}
                      {index < items.length - 1 ? <span className="resize-handle" onMouseDown={tableColumns.startResize(index)} /> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.assets.map((asset, index) => (
                  <tr key={asset.id ?? index}>
                    <td>
                      <input className="cell-input" value={asset.symbol} onChange={(e) => updateAsset(index, { symbol: e.target.value })} />
                    </td>
                    <td>
                      <input className="cell-input" value={asset.selectedSourceExchange} onChange={(e) => updateAsset(index, { selectedSourceExchange: e.target.value })} />
                    </td>
                    <td>
                      <input className="cell-input" value={asset.selectedContractSymbol} onChange={(e) => updateAsset(index, { selectedContractSymbol: e.target.value })} />
                    </td>
                    <td>{draft.bars || '-'}</td>
                    <td>{asset.available_bars ?? '-'}</td>
                    <td>
                      <input className="cell-input" value={asset.file_name ?? ''} onChange={(e) => updateAsset(index, { file_name: e.target.value })} />
                    </td>
                    <td>{asset.last_updated ? new Date(asset.last_updated).toLocaleString() : '-'}</td>
                    <td className="result-add-cell">
                      <button className="icon-button secondary-button" onClick={() => setDraft((current) => ({ ...current, assets: current.assets.filter((_, assetIndex) => assetIndex !== index) }))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {!draft.assets.length ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No assets added yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {saveError ? <div className="modal-error">{saveError}</div> : null}
        </div>

        <div className="modal-actions sticky-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
