export type Chain = "sol" | "bsc" | "robinhood";

export type Signal = {
  id: string;
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  signalType: number;
  signalLabel: string;
  triggerAt: string;
  triggerEpoch: number;
  marketCap: number;
  triggerMarketCap: number;
  firstTriggerMarketCap: number;
  athMarketCap: number;
  liquidity: number;
  holderCount: number;
  top10Rate: number | null;
  rugRatio: number | null;
  washTrading: boolean;
};

export type RankToken = {
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  rank: number;
  price: number;
  marketCap: number;
  athMarketCap: number;
  liquidity: number;
  volume5m: number;
  change5m: number;
  buys5m: number;
  sells5m: number;
  holders: number;
  smartCount: number;
  kolCount: number;
  top10Rate: number | null;
  rugRatio: number | null;
  bundlerRate: number | null;
  insiderRate: number | null;
  washTrading: boolean;
  launchpad?: string;
};

export type AlphaProject = RankToken & {
  key: string;
  smartBuySignals: number;
  kolBuySignals: number;
  contextSignals: number[];
  latestSignalAt: string;
  latestSignalEpoch: number;
  score: number;
  grade: "A+" | "A" | "B+" | "B";
  legacyP0: boolean;
  legacyP0Reasons: string[];
  thesis: string[];
  risks: string[];
};

export type KlineCandle = {
  time: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
};

export type Trader = {
  address: string;
  name: string;
  twitterUsername: string;
  tags: string[];
  cost: number;
  sold: number;
  currentValue: number;
  realizedProfit: number;
  unrealizedProfit: number;
  totalProfit: number;
  realizedRoi: number;
  unrealizedRoi: number;
  totalRoi: number;
  suspicious: boolean;
};

export type WealthStory = {
  type: "cash_out" | "paper_wealth" | "low_cost_moonbag" | "multi_wallet_cluster";
  wallet: string;
  label: string;
  profit: number;
  roi: number;
  cost: number;
  currentValue: number;
};

export type CultureResearch = {
  summary: string;
  origin: string;
  memeMechanism: string;
  communityHooks: string[];
  catalysts: string[];
  fragility: string[];
  confidence: "高" | "中" | "低";
  evidence: string[];
};
