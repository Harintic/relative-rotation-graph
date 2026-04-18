import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SettingsModal } from './components/SettingsModal';
import { api } from './lib/api';
import type { AppSettings, SearchResult } from './lib/types';

const defaultSettings: AppSettings = {
  search: '',
  exchange: '',
  symbol: '',
  interval: 'Daily',
  bars: '5000',
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
  const [resolvedText, setResolvedText] = useState('Select a row to resolve the download symbol.');
  const searchRequestId = useRef(0);

  useEffect(() => {
    void (async () => {
      const remote = await api.loadSettings();
      setSettings((current) => ({ ...current, ...remote }));
    })();
  }, []);

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

  async function download() {
    if (!settings.symbol.trim()) {
      setStatus('Select a symbol before downloading.');
      return;
    }
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>TradingView Data Downloader</h1>
          <p>Local Tauri app with Python sidecar</p>
        </div>
        <button onClick={() => setSettingsOpen(true)}>Settings</button>
      </header>

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

      <footer className="footer">{selectedResult ? `Selected: ${selectedResult.symbol} | ${resolvedText}` : resolvedText}</footer>
    </div>
  );
}
