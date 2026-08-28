import type { HawkesMetrics, HawkesRegime, Signal } from "@/lib/types";

const HORIZON_SECONDS = 2 * 60 * 60;
const HALF_LIFE_SECONDS = 15 * 60;
const BETA = Math.log(2) / HALF_LIFE_SECONDS;
const PRIOR_MEAN = 0.08;
const PRIOR_WEIGHT = 2;
const EPS = 1e-12;

type Event = {
  t: number;
  type: 0 | 1; // 0=Smart Money, 1=KOL
  mark: number;
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, d = 4) => Number(x.toFixed(d));

function spectralRadius2x2(a00: number, a01: number, a10: number, a11: number) {
  const disc = Math.sqrt(Math.max(0, (a00 - a11) ** 2 + 4 * a01 * a10));
  return Math.max(0, (a00 + a11 + disc) / 2);
}

function normalizeMarks(raw: Array<number | null>): number[] {
  const transformed = raw.map(v => v && v > 0 ? Math.max(0.25, Math.log1p(v / 1_000)) : 1);
  const mean = transformed.reduce((s, x) => s + x, 0) / Math.max(1, transformed.length);
  return transformed.map(x => clamp(x / Math.max(mean, EPS), 0.25, 4));
}

function regimeOf(rho: number, endogenous: number, smToKol: number, kolToSm: number, n: number): HawkesRegime {
  if (n < 2) return "insufficient";
  if (rho >= 0.95 || endogenous >= 0.8) return "overheated";
  if (smToKol > 0.12 && smToKol > kolToSm * 1.25 && endogenous >= 0.25) return "upstream_ignition";
  if (rho >= 0.4 || endogenous >= 0.4) return "cascade";
  return "dormant";
}

function confidenceOf(events: Event[]) {
  const smart = events.filter(e => e.type === 0).length;
  const kol = events.length - smart;
  if (events.length >= 12 && smart >= 3 && kol >= 3) return "high" as const;
  if (events.length >= 6 && smart >= 2 && kol >= 2) return "medium" as const;
  return "low" as const;
}

export function estimateMarkedBivariateHawkes(signals: Signal[], nowEpoch = Date.now() / 1000): HawkesMetrics {
  const cutoff = nowEpoch - HORIZON_SECONDS;
  const directIdentity = signals.filter(s =>
    (s.signalType === 12 || s.signalType === 20) &&
    s.triggerEpoch >= cutoff &&
    s.triggerEpoch <= nowEpoch + 5 &&
    !!s.identitySource,
  );
  const identity = directIdentity.length ? directIdentity : signals.filter(s =>
    (s.signalType === 12 || s.signalType === 20) && s.triggerEpoch >= cutoff && s.triggerEpoch <= nowEpoch + 5,
  );

  const marks = normalizeMarks(identity.map(s => s.tradeUsd && s.tradeUsd > 0 ? s.tradeUsd : null));
  const events: Event[] = identity.map((s, i) => ({
    t: s.triggerEpoch,
    type: s.signalType === 12 ? 0 : 1,
    mark: marks[i],
  })).sort((a, b) => a.t - b.t);

  const smartEvents = events.filter(e => e.type === 0).length;
  const kolEvents = events.length - smartEvents;
  const markCoverage = identity.length
    ? identity.filter(s => (s.tradeUsd || 0) > 0).length / identity.length
    : 0;

  if (!events.length) {
    return {
      version: "marked-bivariate-em-v1",
      horizonMinutes: HORIZON_SECONDS / 60,
      kernelHalfLifeMinutes: HALF_LIFE_SECONDS / 60,
      eventCount: 0,
      smartEvents: 0,
      kolEvents: 0,
      markCoverage: 0,
      reproductionNumber: 0,
      endogenousRatio: 0,
      smartToSmart: 0,
      smartToKol: 0,
      kolToSmart: 0,
      kolToKol: 0,
      directionalEdge: 0,
      regime: "insufficient",
      confidence: "low",
    };
  }

  const start = Math.min(cutoff, events[0].t);
  const T = Math.max(60, nowEpoch - start);
  const counts = [smartEvents, kolEvents];
  let mu = [Math.max(1e-6, (counts[0] + 0.5) / T * 0.55), Math.max(1e-6, (counts[1] + 0.5) / T * 0.55)];
  // Matrix is target x source. a[1][0] = Smart Money -> KOL.
  let a = [[PRIOR_MEAN, PRIOR_MEAN], [PRIOR_MEAN, PRIOR_MEAN]];
  let finalEndogenous = 0;

  for (let iter = 0; iter < 10; iter++) {
    const immigrant = [0, 0];
    const offspring = [[0, 0], [0, 0]];
    let totalOffspringProbability = 0;

    for (let k = 0; k < events.length; k++) {
      const target = events[k];
      let lambda = mu[target.type];
      const contributions: Array<{ sourceType: 0 | 1; value: number }> = [];
      for (let l = 0; l < k; l++) {
        const source = events[l];
        const dt = target.t - source.t;
        if (dt <= 0 || dt > HORIZON_SECONDS) continue;
        const value = a[target.type][source.type] * BETA * Math.exp(-BETA * dt) * source.mark;
        if (value <= 0) continue;
        lambda += value;
        contributions.push({ sourceType: source.type, value });
      }
      lambda = Math.max(lambda, EPS);
      immigrant[target.type] += mu[target.type] / lambda;
      for (const c of contributions) {
        const p = c.value / lambda;
        offspring[target.type][c.sourceType] += p;
        totalOffspringProbability += p;
      }
    }

    const exposure = [0, 0];
    for (const source of events) {
      const remaining = Math.max(0, nowEpoch - source.t);
      exposure[source.type] += source.mark * (1 - Math.exp(-BETA * remaining));
    }

    for (let i = 0; i < 2; i++) {
      const rawMu = immigrant[i] / T;
      const weakRatePrior = (counts[i] + 0.5) / (T + 300);
      mu[i] = Math.max(1e-6, 0.85 * rawMu + 0.15 * weakRatePrior);
      for (let j = 0; j < 2; j++) {
        const posterior = (offspring[i][j] + PRIOR_WEIGHT * PRIOR_MEAN) / (exposure[j] + PRIOR_WEIGHT);
        a[i][j] = clamp(posterior, 0, 1.5);
      }
    }

    finalEndogenous = totalOffspringProbability / events.length;
  }

  const smartToSmart = a[0][0];
  const kolToSmart = a[0][1];
  const smartToKol = a[1][0];
  const kolToKol = a[1][1];
  const rho = spectralRadius2x2(smartToSmart, kolToSmart, smartToKol, kolToKol);
  const endogenousRatio = clamp(finalEndogenous, 0, 1);
  const directionalEdge = Math.log((smartToKol + 0.05) / (kolToSmart + 0.05));

  return {
    version: "marked-bivariate-em-v1",
    horizonMinutes: HORIZON_SECONDS / 60,
    kernelHalfLifeMinutes: HALF_LIFE_SECONDS / 60,
    eventCount: events.length,
    smartEvents,
    kolEvents,
    markCoverage: round(markCoverage),
    reproductionNumber: round(rho),
    endogenousRatio: round(endogenousRatio),
    smartToSmart: round(smartToSmart),
    smartToKol: round(smartToKol),
    kolToSmart: round(kolToSmart),
    kolToKol: round(kolToKol),
    directionalEdge: round(directionalEdge),
    regime: regimeOf(rho, endogenousRatio, smartToKol, kolToSmart, events.length),
    confidence: confidenceOf(events),
  };
}
