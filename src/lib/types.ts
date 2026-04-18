export type SearchResult = {
  symbol?: string;
  name?: string;
  description?: string;
  shortname?: string;
  exchange?: string;
  source_id?: string;
  contracts?: Array<{ symbol?: string }>;
  [key: string]: unknown;
};

export type ResolveResponse = {
  download_symbol: string;
  download_exchange: string;
  fut_contract: number | null;
  resolved: string;
};

export type SetAsset = {
  id?: string;
  search: string;
  exchange: string;
  symbol: string;
  selectedSourceExchange: string;
  selectedBaseSymbol: string;
  selectedContractSymbol: string;
  file_name?: string;
  last_updated?: string;
  available_bars?: number | string;
};

export type DataSet = {
  id: string;
  name: string;
  interval: string;
  bars?: string;
  folder_name: string;
  assets: SetAsset[];
  created_at?: string;
  updated_at?: string;
};

export type SetSyncResult = {
  set: DataSet;
  folder: string;
  action: 'download' | 'update';
  total: number;
  success: number;
  failed: number;
  results: Array<{
    asset_id?: string;
    file_name: string;
    ok: boolean;
    rows?: number;
    saved_path?: string;
    resolved_symbol?: string;
    resolved_exchange?: string;
    fut_contract?: number | null;
    last_updated?: string;
    error?: string;
  }>;
};

export type LogEntry = {
  id: number;
  ts: string;
  level: string;
  source: string;
  message: string;
};

export type ApiMeta = {
  version: string;
  features: {
    retry_failed?: boolean;
    logs?: boolean;
    sets?: boolean;
  };
};

export type AppSettings = {
  search: string;
  exchange: string;
  symbol: string;
  interval: string;
  bars: string;
  theme: 'dark' | 'light';
  outputMode: 'browser' | 'folder' | 'both';
  saveFolder: string;
  username: string;
  password: string;
  selectedSourceExchange: string;
  selectedBaseSymbol: string;
  selectedContractSymbol: string;
};
