import type { AppSettings, ResolveResponse, SearchResult } from './types';
import { open } from '@tauri-apps/plugin-dialog';

const baseUrl = 'http://127.0.0.1:8765';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  loadSettings() {
    return json<Partial<AppSettings>>('/api/settings');
  },
  saveSettings(settings: AppSettings) {
    return json<{ ok: boolean }>('/api/settings', { method: 'POST', body: JSON.stringify(settings) });
  },
  search(query: string, exchange: string) {
    return json<{ results: SearchResult[]; count: number }>('/api/search', {
      method: 'POST',
      body: JSON.stringify({ query, exchange }),
    });
  },
  resolve(baseSymbol: string, sourceExchange: string, contractSymbol: string) {
    return json<ResolveResponse>('/api/resolve', {
      method: 'POST',
      body: JSON.stringify({
        base_symbol: baseSymbol,
        source_exchange: sourceExchange,
        contract_symbol: contractSymbol,
      }),
    });
  },
  download(settings: AppSettings) {
    return json<{ csv: string; rows: number; savedPath: string }>('/api/download', {
      method: 'POST',
      body: JSON.stringify({
        symbol: settings.symbol,
        exchange: settings.selectedSourceExchange || settings.exchange,
        interval: settings.interval,
        bars: Number(settings.bars) || 5000,
        username: settings.username,
        password: settings.password,
        contract_symbol: settings.selectedContractSymbol,
        base_symbol: settings.selectedBaseSymbol,
        save_folder: settings.saveFolder,
        output_mode: settings.outputMode,
      }),
    });
  },
  async pickFolder() {
    const result = await open({ directory: true, multiple: false, title: 'Select save folder' });
    return typeof result === 'string' ? result : '';
  },
};
