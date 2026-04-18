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

export type AppSettings = {
  search: string;
  exchange: string;
  symbol: string;
  interval: string;
  bars: string;
  outputMode: 'browser' | 'folder' | 'both';
  saveFolder: string;
  username: string;
  password: string;
  selectedSourceExchange: string;
  selectedBaseSymbol: string;
  selectedContractSymbol: string;
};
