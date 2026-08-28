import { unstable_cache } from "next/cache";
import { fetchRank, fetchSignals, fetchTopTraders, SIGNAL_CHAINS } from "@/lib/gmgn";
import type { Chain, RankToken, Signal, Trader } from "@/lib/types";

export type ChainDiagnostics = {
  chain: Chain;
  signalCount: number;
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

  // Intentionally sequential. The old implementation fired six GMGN requests at once
  // and hit burst-rate limits. MemeToGo now uses its own key, but still paces requests.
  for (const chain of SIGNAL_CHAINS) {
    const errors: string[] = [];
    let chainSignals: Signal[] = [];
    let chainRanks: RankToken[] = [];

    try {
      chainSignals = await fetchSignals(chain);
      signals.push(...chainSignals);
    } catch (error) {
      errors.push(`Signal: ${error instanceof Error ? error.message : String(error)}`);
    }

    await pause(400);

    try {
      chainRanks = await fetchRank(chain);
      ranks.push(...chainRanks);
    } catch (error) {
      errors.push(`Rank: ${error instanceof Error ? error.message : String(error)}`);
    }

    diagnostics.push({
      chain,
      signalCount: chainSignals.length,
      rankCount: chainRanks.length,
      errors,
    });

    await pause(400);
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
  ["memetogo-independent-gmgn-snapshot-v1"],
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
