import type { HawkesMetrics, HawkesRegime, Signal } from "@/lib/types";

const HORIZON_CANDIDATES = [2 * 60 * 60, 6 * 60 * 60, 24 * 60 * 60];
const HALF_LIFE_CANDIDATES = [10 * 60, 30 * 60, 90 * 60];
const TARGET_LOCAL_EVENTS = 4;
const PRIOR_MEAN = 0.08;
const PRIOR_WEIGHT = 1.5;
const PRIOR_EQUIVALENT_PAIRS = 3;
const EPS = 1e-12;

type Event = {
  t: number;
  type: 0 | 1; // 0=Smart Money, 1=KOL
  mark: number;
};

type Fit = {
  a: number[][];
  mu: number[];
  endogenous: number;
  logLikelihood: number;
  beta: number;
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

function chooseHorizon(identity: Signal[], nowEpoch: number) {
  for (const horizon of HORIZON_CANDIDATES) {
    const n = identity.filter(s => s.triggerEpoch >= nowEpoch - horizon && s.triggerEpoch <= nowEpoch + 5).length;
    if (n >= TARGET_LOCAL_EVENTS) return horizon;
  }
  return HORIZON_CANDIDATES[HORIZON_CANDIDATES.length - 1];
}

function fitHawkes(events: Event[], start: number, nowEpoch: number, halfLifeSeconds: number): Fit {
  const beta = Math.log(2) / halfLifeSeconds;
  const T = Math.max(60, nowEpoch - start);
  const counts = [events.filter(e => e.type === 0).length, events.filter(e => e.type === 1).length];
  let mu = [Math.max(1e-7, (counts[0] + 0.5) / T * 0.6), Math.max(1e-7, (counts[1] + 0.5) / T * 0.6)];
  let a = [[PRIOR_MEAN, PRIOR_MEAN], [PRIOR_MEAN, PRIOR_MEAN]];
  let finalEndogenous = 0;

  for (let iter = 0; iter < 12; iter++) {
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
        if (dt <= 0) continue;
        const value = a[target.type][source.type] * beta * Math.exp(-beta * dt) * source.mark;
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
      exposure[source.type] += source.mark * (1 - Math.exp(-beta * remaining));
    }

    for (let i = 0; i < 2; i++) {
      const rawMu = immigrant[i] / T;
      const weakRatePrior = (counts[i] + 0.5) / (T + 300);
      mu[i] = Math.max(1e-7, 0.88 * rawMu + 0.12 * weakRatePrior);
      for (let j = 0; j < 2; j++) {
        const posterior = (offspring[i][j] + PRIOR_WEIGHT * PRIOR_MEAN) / (exposure[j] + PRIOR_WEIGHT);
        a[i][j] = clamp(posterior, 0, 1.5);
      }
    }
    finalEndogenous = events.length ? totalOffspringProbability / events.length : 0;
  }

  let logLikelihood = 0;
  for (let k = 0; k < events.length; k++) {
    const target = events[k];
    let lambda = mu[target.type];
    for (let l = 0; l < k; l++) {
      const source = events[l];
      const dt = target.t - source.t;
      if (dt <= 0) continue;
      lambda += a[target.type][source.type] * beta * Math.exp(-beta * dt) * source.mark;
    }
    logLikelihood += Math.log(Math.max(lambda, EPS));
  }
  logLikelihood -= (mu[0] + mu[1]) * T;
  for (const source of events) {
    const remaining = Math.max(0, nowEpoch - source.t);
    const kernelMass = source.mark * (1 - Math.exp(-beta * remaining));
    logLikelihood -= kernelMass * (a[0][source.type] + a[1][source.type]);
  }

  return { a, mu, endogenous: clamp(finalEndogenous, 0, 1), logLikelihood, beta };
}

function regimeOf(rho: number, endogenous: number, smToKol: number, kolToSm: number, smart: number, kol: number): HawkesRegime {
  const n = smart + kol;
  if (n === 0) return "insufficient";
  if (n === 1) return "seed";
  if (rho >= 0.95 || endogenous >= 0.8) return "overheated";
  if (smart === 0 || kol === 0) return "unilateral";
  if (smToKol > 0.12 && smToKol > kolToSm * 1.25 && endogenous >= 0.25) return "upstream_ignition";
  if (rho >= 0.4 || endogenous >= 0.4) return "cascade";
  return "dormant";
}

function confidenceOf(n: number, smart: number, kol: number, localEvidenceWeight: number) {
  if (n >= 10 && smart >= 2 && kol >= 2 && localEvidenceWeight >= 0.65) return "high" as const;
  if (n >= 4 && localEvidenceWeight >= 0.35) return "medium" as const;
  return "low" as const;
}

export function estimateMarkedBivariateHawkes(signals: Signal[], nowEpoch = Date.now() / 1000): HawkesMetrics {
  const direct = signals.filter(s => (s.signalType === 12 || s.signalType === 20) && !!s.identitySource && s.triggerEpoch <= nowEpoch + 5);
  const fallback = signals.filter(s => (s.signalType === 12 || s.signalType === 20) && s.triggerEpoch <= nowEpoch + 5);
  const allIdentity = direct.length ? direct : fallback;
  const horizonSeconds = chooseHorizon(allIdentity, nowEpoch);
  const cutoff = nowEpoch - horizonSeconds;
  const identity = allIdentity.filter(s => s.triggerEpoch >= cutoff);

  if (!identity.length) {
    return {
      version: "marked-bivariate-em-v2-adaptive",
      horizonMinutes: horizonSeconds / 60,
      kernelHalfLifeMinutes: 30,
      eventCount: 0,
      smartEvents: 0,
      kolEvents: 0,
      markCoverage: 0,
      localEvidenceWeight: 0,
      expectedTriggered60m: 0,
      latestEventType: "none",
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

  const marks = normalizeMarks(identity.map(s => s.tradeUsd && s.tradeUsd > 0 ? s.tradeUsd : null));
  const events: Event[] = identity.map((s, i): Event => ({
    t: s.triggerEpoch,
    type: s.signalType === 12 ? 0 : 1,
    mark: marks[i],
  })).sort((a, b) => a.t - b.t);

  const smartEvents = events.filter(e => e.type === 0).length;
  const kolEvents = events.length - smartEvents;
  const markCoverage = identity.filter(s => (s.tradeUsd || 0) > 0).length / identity.length;
  const start = Math.min(cutoff, events[0].t);

  const candidateHalfLives = HALF_LIFE_CANDIDATES.filter(v => v <= horizonSeconds / 2);
  if (!candidateHalfLives.length) candidateHalfLives.push(30 * 60);
  const fits = candidateHalfLives.map(halfLife => ({ halfLife, fit: fitHawkes(events, start, nowEpoch, halfLife) }));
  const chosen = events.length >= 2
    ? fits.reduce((best, row) => row.fit.logLikelihood > best.fit.logLikelihood ? row : best)
    : fits.reduce((best, row) => Math.abs(row.halfLife - 30 * 60) < Math.abs(best.halfLife - 30 * 60) ? row : best);

  const a = chosen.fit.a;
  const smartToSmart = a[0][0];
  const kolToSmart = a[0][1];
  const smartToKol = a[1][0];
  const kolToKol = a[1][1];
  const rho = spectralRadius2x2(smartToSmart, kolToSmart, smartToKol, kolToKol);
  const endogenousRatio = chosen.fit.endogenous;
  const directionalEdge = Math.log((smartToKol + 0.05) / (kolToSmart + 0.05));
  const observedPairs = Math.max(0, events.length - 1);
  const localEvidenceWeight = observedPairs / (observedPairs + PRIOR_EQUIVALENT_PAIRS);

  const latest = events[events.length - 1];
  const oneHourKernelMass = 1 - Math.exp(-chosen.fit.beta * 3600);
  const expectedTriggered60m = latest.mark * (a[0][latest.type] + a[1][latest.type]) * oneHourKernelMass;

  return {
    version: "marked-bivariate-em-v2-adaptive",
    horizonMinutes: horizonSeconds / 60,
    kernelHalfLifeMinutes: chosen.halfLife / 60,
    eventCount: events.length,
    smartEvents,
    kolEvents,
    markCoverage: round(markCoverage),
    localEvidenceWeight: round(localEvidenceWeight),
    expectedTriggered60m: round(expectedTriggered60m),
    latestEventType: latest.type === 0 ? "smart" : "kol",
    reproductionNumber: round(rho),
    endogenousRatio: round(endogenousRatio),
    smartToSmart: round(smartToSmart),
    smartToKol: round(smartToKol),
    kolToSmart: round(kolToSmart),
    kolToKol: round(kolToKol),
    directionalEdge: round(directionalEdge),
    regime: regimeOf(rho, endogenousRatio, smartToKol, kolToSmart, smartEvents, kolEvents),
    confidence: confidenceOf(events.length, smartEvents, kolEvents, localEvidenceWeight),
  };
}
