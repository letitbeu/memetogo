import { estimateMarkedBivariateHawkes } from "@/lib/hawkes";
import type { AlphaProject, Chain, Signal } from "@/lib/types";

const HISTORY_KEY = "memetogo:identity-events:v1";
const HISTORY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 6000;

export type IdentityHistoryEvent = {
  id: string;
  chain: Chain;
  address: string;
  signalType: number;
  triggerEpoch: number;
  tradeUsd?: number;
  identitySource?: "smartmoney_feed" | "kol_feed" | null;
};

function valid(row: unknown): row is IdentityHistoryEvent {
  if (!row || typeof row !== "object") return false;
  const x = row as Record<string, unknown>;
  return typeof x.id === "string" && typeof x.address === "string" &&
    (x.chain === "sol" || x.chain === "bsc" || x.chain === "robinhood") &&
    (x.signalType === 12 || x.signalType === 20) && Number.isFinite(Number(x.triggerEpoch));
}

export function loadIdentityHistory(now = Date.now()): IdentityHistoryEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const cutoff = now / 1000 - HISTORY_MS / 1000;
    return parsed.filter(valid).filter(row => row.triggerEpoch >= cutoff).slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

export function mergeIdentityHistory(previous: IdentityHistoryEvent[], incoming: IdentityHistoryEvent[], now = Date.now()) {
  const cutoff = now / 1000 - HISTORY_MS / 1000;
  const map = new Map<string, IdentityHistoryEvent>();
  for (const row of [...incoming, ...previous]) {
    if (!valid(row) || row.triggerEpoch < cutoff) continue;
    if (!map.has(row.id)) map.set(row.id, row);
  }
  const merged = [...map.values()].sort((a, b) => b.triggerEpoch - a.triggerEpoch).slice(0, MAX_EVENTS);
  if (typeof window !== "undefined") {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(merged)); } catch { /* storage pressure: keep runtime copy */ }
  }
  return merged;
}

function asSignal(row: IdentityHistoryEvent): Signal {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    symbol: "",
    name: "",
    signalType: row.signalType,
    signalLabel: row.signalType === 12 ? "聪明钱买入" : "KOL买入",
    triggerAt: new Date(row.triggerEpoch * 1000).toISOString(),
    triggerEpoch: row.triggerEpoch,
    marketCap: 0,
    triggerMarketCap: 0,
    firstTriggerMarketCap: 0,
    athMarketCap: 0,
    liquidity: 0,
    holderCount: 0,
    top10Rate: null,
    rugRatio: null,
    washTrading: false,
    tradeUsd: row.tradeUsd && row.tradeUsd > 0 ? row.tradeUsd : undefined,
    identitySource: row.identitySource || (row.signalType === 12 ? "smartmoney_feed" : "kol_feed"),
  };
}

export function enrichProjectsWithIdentityHistory(projects: AlphaProject[], history: IdentityHistoryEvent[]) {
  const groups = new Map<string, Signal[]>();
  for (const event of history) {
    const key = `${event.chain}:${event.address.toLowerCase()}`;
    const rows = groups.get(key) || [];
    rows.push(asSignal(event));
    groups.set(key, rows);
  }
  return projects.map(project => {
    const rows = groups.get(project.key) || [];
    if (!rows.length) return project;
    return { ...project, hawkes: estimateMarkedBivariateHawkes(rows) };
  });
}
