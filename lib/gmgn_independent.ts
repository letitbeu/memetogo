import { unstable_cache } from "next/cache";
import { fetchKline, fetchRank, fetchTokenInfo, fetchTopTraders, SIGNAL_CHAINS } from "@/lib/gmgn";
import { fetchIdentityBuySignals } from "@/lib/gmgn_identity";
import type { Chain, KlineCandle, RankToken, Signal, Trader } from "@/lib/types";

export type ChainDiagnostics = {
  chain: Chain;
  signalCount: number;
  signalRawRows: number;
  signalParsedRows: number;
  signalTypeCounts: Record<string, number>;
  smartTradeRows: number;
  smartBuyRows: number;
  kolTradeRows: number;
  kolBuyRows: number;
  identityWarnings: string[];
  rankCount: number;
  errors: string[];
};

export type IndependentSnapshot = {
  capturedAt: string;
  signals: Signal[];
  ranks: RankToken[];
  diagnostics: ChainDiagnostics[];
};

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function collectFresh(): Promise<IndependentSnapshot> {
  const signals: Signal[] = [];
  const ranks: RankToken[] = [];
  const diagnostics: ChainDiagnostics[] = [];

  // Budgeted production path: 4 chains × (Smart/KOL identity feeds + Rank) = 12 calls / 120s.
  // Arc is collected through GMGN directly so launch-day indexing does not depend on third parties.
  for (const chain of SIGNAL_CHAINS) {
    const errors: string[] = [];
    let chainSignals: Signal[] = [];
    let chainRanks: RankToken[] = [];
    let smartTradeRows = 0;
    let smartBuyRows = 0;
    let kolTradeRows = 0;
    let kolBuyRows = 0;
    let identityWarnings: string[] = [];

    try {
      const identityResult = await fetchIdentityBuySignals(chain);
      chainSignals = identityResult.signals;
      signals.push(...chainSignals);
      smartTradeRows = identityResult.diagnostic.smartRawRows;
      smartBuyRows = identityResult.diagnostic.smartBuyRows;
      kolTradeRows = identityResult.diagnostic.kolRawRows;
      kolBuyRows = identityResult.diagnostic.kolBuyRows;
      identityWarnings = identityResult.diagnostic.warnings;
    } catch (error) {
      identityWarnings.push(`Identity: ${error instanceof Error ? error.message : String(error)}`);
    }

    await pause(700);

    try {
      chainRanks = await fetchRank(chain);
      ranks.push(...chainRanks);
    } catch (error) {
      errors.push(`Rank: ${error instanceof Error ? error.message : String(error)}`);
    }

    diagnostics.push({
      chain,
      signalCount: chainSignals.length,
      signalRawRows: 0,
      signalParsedRows: 0,
      signalTypeCounts: {},
      smartTradeRows,
      smartBuyRows,
      kolTradeRows,
      kolBuyRows,
      identityWarnings,
      rankCount: chainRanks.length,
      errors,
    });

    await pause(700);
  }

  const rankSuccessCount = diagnostics.filter(row => row.rankCount > 0 && !row.errors.some(error => error.startsWith("Rank:"))).length;
  if (rankSuccessCount === 0) {
    const detail = diagnostics
      .flatMap(row => row.errors.map(error => `${row.chain}:${error}`))
      .slice(0, 4)
      .join(" | ");
    throw new Error(`GMGN 行情Rank全部采集失败${detail ? `：${detail}` : ""}`);
  }

  return {
    capturedAt: new Date().toISOString(),
    signals,
    ranks,
    diagnostics,
  };
}

const cachedSnapshot = unstable_cache(
  collectFresh,
  ["memetogo-independent-gmgn-snapshot-v5-arc"],
  { revalidate: 120 },
);

let inFlight: Promise<IndependentSnapshot> | null = null;

export async function fetchIndependentSnapshot(): Promise<IndependentSnapshot> {
  if (inFlight) return inFlight;
  inFlight = cachedSnapshot().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

const cachedTopTraders = unstable_cache(
  async (chain: Chain, address: string): Promise<Trader[]> => fetchTopTraders(chain, address),
  ["memetogo-independent-gmgn-top-traders-v1"],
  { revalidate: 300 },
);

export async function fetchIndependentTopTraders(chain: Chain, address: string): Promise<Trader[]> {
  return cachedTopTraders(chain, address.toLowerCase());
}

const cachedTokenInfo = unstable_cache(
  async (chain: Chain, address: string) => fetchTokenInfo(chain, address),
  ["memetogo-independent-gmgn-token-info-v1"],
  { revalidate: 300 },
);

export async function fetchIndependentTokenInfo(chain: Chain, address: string) {
  return cachedTokenInfo(chain, address.toLowerCase());
}

const cachedKline = unstable_cache(
  async (chain: Chain, address: string, resolution: string, hours: number): Promise<KlineCandle[]> => fetchKline(chain, address, resolution, hours),
  ["memetogo-independent-gmgn-kline-v1"],
  { revalidate: 30 },
);

export async function fetchIndependentKline(chain: Chain, address: string, resolution = "5m", hours = 24): Promise<KlineCandle[]> {
  return cachedKline(chain, address.toLowerCase(), resolution, hours);
}

export function tokenContext(snapshot: IndependentSnapshot, chain: Chain, address: string) {
  const target = address.toLowerCase();
  const rank = snapshot.ranks.find(row => row.chain === chain && row.address.toLowerCase() === target) || null;
  const signals = snapshot.signals
    .filter(row => row.chain === chain && row.address.toLowerCase() === target)
    .sort((a, b) => b.triggerEpoch - a.triggerEpoch);
  return { rank, signals };
}
