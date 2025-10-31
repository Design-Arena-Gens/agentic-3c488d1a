export interface Pi42Contract {
  name: string;
  contractName: string;
  slug?: string;
  tags?: string[];
  makerFee: number;
  takerFee: number;
  baseAsset: string;
  quoteAsset: string;
  maxLeverage?: number | string;
  contractType?: string;
  pricePrecision?: number | string;
  quantityPrecision?: number | string;
  iconUrl?: string;
  market?: string;
  marginAssetsSupported?: string[];
  maintenanceMarginPercentage?: number | string;
  maxLeverageStr?: string;
  depthGrouping?: string[];
  [key: string]: unknown;
}

export interface Pi42ExchangeInfo {
  markets: string[];
  contracts: Pi42Contract[];
}

export interface Pi42MarketInfoEntry {
  lastPrice?: string;
  marketPrice?: string;
  priceChangePercent?: string;
  baseAssetVolume?: string;
  quoteAssetVolume?: string;
  upcomingFundingRate?: string;
  [key: string]: unknown;
}

export type Pi42MarketInfo = Record<string, Pi42MarketInfoEntry>;

export interface Pi42Ticker {
  e: string;
  E: number;
  s: string;
  p: string;
  P: string;
  w: string;
  c: string;
  Q: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
  O: number;
  C: number;
  F: number;
  L: number;
  n: number;
}

export interface Pi42DepthResponse {
  e: string;
  E: number;
  T: number;
  s: string;
  U: number;
  u: number;
  pu: number;
  b: [string, string][];
  a: [string, string][];
}

export interface Pi42AggTrade {
  e: string;
  E: number;
  a: number;
  s: string;
  p: string;
  q: string;
  f: number;
  l: number;
  T: number;
  m: boolean;
}

export interface Pi42Kline {
  startTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  endTime: string;
  volume: string;
}

export interface EndpointDescriptor {
  id: string;
  method: string;
  path: string;
  section: string;
  subgroup?: string;
  description?: string;
  anchor?: string;
}

export interface CombinedContractMetrics {
  contract: Pi42Contract;
  marketStats?: Pi42MarketInfoEntry;
  market: string;
  lastPrice?: number;
  markPrice?: number;
  priceChangePercent?: number;
  baseVolume?: number;
  quoteVolume?: number;
  fundingRateBps?: number;
}
