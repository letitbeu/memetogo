import { unstable_cache } from "next/cache";
import { fetchRank, fetchSignalsDetailed, fetchTopTraders, SIGNAL_CHAINS } from "@/lib/gmgn";
import { fetchIdentityBuySignals } from "@/lib/gmgn_identity";
import type { Chain, RankToken, Signal, Trader } from "@/lib/types";

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

  // Sequential per chain to protect the dedicated MemeToGo GMGN key from burst limits.
  for (const chain of SIGNAL_CHAINS) {
    const errors: string[] = [];
    const mergedSignals = new Map<string, Signal>();
    let chainRanks: RankToken[] = [];
    let signalRawRows = 0;
    let signalParsedRows = 0;
    let signalTypeCounts: Record<string, number> = {};
    let smartTradeRows = 0;
    let smartBuyRows = 0;
    let kolTradeRows = 0;
    let kolBuyRows = 0;
    let identityWarnings: string[] = [];

    // Primary identity-flow source: actual GMGN Smart Money/KOL trade feeds.
    // These are API-key-only public platform-tagged wallet streams.
    try {
      const identityResult = await fetchIdentityBuySignals(chain);
      for (const signal of identityResult.signals) mergedSignals.set(signal.id, signal);
      smartTradeRows = identityResult.diagnostic.smartRawRows;
      smartBuyRows = identityResult.diagnostic.smartBuyRows;
      kolTradeRows = identityResult.diagnostic.kolRawRows;
      kolBuyRows = identityResult.diagnostic.kolBuyRows;
      identityWarnings = identityResult.diagnostic.warnings;
    } catch (error) {
      identityWarnings.push(`Identity: ${error instanceof Error ? error.message : String(error)}`);
    }

    await pause(350);

    // Secondary/context source: market token_signal. It supplies price/ATH/large-buy
    // P0 context when available, but an empty token_signal response cannot disable
    // the Smart/KOL hard gate because identity BUY trades are collected above.
    try {
      const signalResult = await fetchSignalsDetailed(chain);
      for (const signal of signalResult.signals) mergedSignals.set(signal.id, signal);
      signalRawRows = signalResult.diagnostic.rawRows;
      signalParsedRows = signalResult.diagnostic.parsedRows;
      signalTypeCounts = signalResult.diagnostic.rawTypeCounts;
    } catch (error) {
      errors.push(`Signal context: ${error instanceof Error ? error.message : String(error)}`);
    }

    await pause(350);

    try {
      chainRanks = await fetchRank(chain);
      ranks.push(...chainRanks);
    } catch (error) {
      errors.push(`Rank: ${error instanceof Error ? error.message : String(error)}`);
    }

    const chainSignals = [...mergedSignals.values()].sort((a, b) => b.triggerEpoch - a.triggerEpoch);
    signals.push(...chainSignals);

    diagnostics.push({
      chain,
      signalCount: chainSignals.length,
      signalRawRows,
      signalParsedRows,
      signalTypeCounts,
      smartTradeRows,
      smartBuyRows,
      kolTradeRows,
      kolBuyRows,
      identityWarnings,
      rankCount: chainRanks.length,
      errors,
    });

    await pause(350);
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
  ["memetogo-independent-gmgn-snapshot-v3"],
  { revalidate: 60 },
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

export function tokenContext(snapshot: IndependentSnapshot, chain: Chain, address: string) {
  const target = address.toLowerCase();
  const rank = snapshot.ranks.find(row => row.chain === chain && row.address.toLowerCase() === target) || null;
  const signals = snapshot.signals
    .filter(row => row.chain === chain && row.address.toLowerCase() === target)
    .sort((a, b) => b.triggerEpoch - a.triggerEpoch);
  return { rank, signals };
}
