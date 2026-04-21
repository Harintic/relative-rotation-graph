import type { ApiMeta, AppSettings, DataSet, LogEntry, ResolveResponse, RrCreateResponse, SearchResult, SetAsset, SetSyncResult } from './types';
import { open } from '@tauri-apps/plugin-dialog';

const baseUrl = 'http://127.0.0.1:8765';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error || message;
    } catch {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {
        // keep default message
      }
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  loadSettings() {
    return json<Partial<AppSettings>>('/api/settings');
  },
  meta() {
    return json<ApiMeta>('/api/meta');
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
  listSets() {
    return json<{ sets: DataSet[] }>('/api/sets');
  },
  createSet(value: { name: string; interval: string; bars: string; assets: SetAsset[] }) {
    return json<{ set: DataSet }>('/api/sets', {
      method: 'POST',
      body: JSON.stringify(value),
    });
  },
  updateSet(id: string, value: { name: string; interval: string; bars: string; assets: SetAsset[] }) {
    return json<{ set: DataSet }>(`/api/sets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(value),
    });
  },
  deleteSet(id: string) {
    return json<{ ok: boolean }>(`/api/sets/${id}`, { method: 'DELETE' });
  },
  duplicateSet(id: string) {
    return json<{ set: DataSet }>(`/api/sets/${id}/duplicate`, { method: 'POST' });
  },
  downloadSet(id: string) {
    return json<SetSyncResult>(`/api/sets/${id}/download`, { method: 'POST' });
  },
  updateSetData(id: string) {
    return json<SetSyncResult>(`/api/sets/${id}/update`, { method: 'POST' });
  },
  retryFailedSet(id: string, assetIds?: string[]) {
    return json<SetSyncResult>(`/api/sets/${id}/retry-failed`, {
      method: 'POST',
      body: JSON.stringify({ asset_ids: assetIds || [] }),
    });
  },
  logs(since = 0, limit = 500) {
    return json<{ logs: LogEntry[]; next_id: number }>(`/api/logs?since=${since}&limit=${limit}`);
  },
  clearLogs() {
    return json<{ ok: boolean }>('/api/logs', { method: 'DELETE' });
  },
  createRrg(setId: string, options?: { benchmarkAssetId?: string; lookbackDays?: number; includedAssetIds?: string[]; missingMode?: 'skip' | 'ffill'; formula?: 'Default' | 'Jdk' }) {
    return json<RrCreateResponse>('/api/rrg', {
      method: 'POST',
      body: JSON.stringify({
        set_id: setId,
        benchmark_asset_id: options?.benchmarkAssetId || '',
        lookback_days: options?.lookbackDays || 10,
        included_asset_ids: options?.includedAssetIds || [],
        missing_mode: options?.missingMode || 'skip',
        formula: options?.formula || 'Default',
      }),
    });
  },
  async pickFolder() {
    const result = await open({ directory: true, multiple: false, title: 'Select save folder' });
    return typeof result === 'string' ? result : '';
  },
};
