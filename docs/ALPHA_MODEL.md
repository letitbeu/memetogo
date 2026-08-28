# MemeToGo Alpha Model v0.1

## 1. Product hierarchy

The hierarchy is not “what is pumping?”. It is:

1. **Who is buying?** Recent Smart Money or KOL BUY is mandatory.
2. **Are independent identity cohorts resonating?** Smart Money + KOL is stronger than either alone.
3. **Is market microstructure confirming?** Volume rank, buy/sell imbalance, liquidity and price acceleration.
4. **Does the old P0/P0+ engine confirm strength?** P0 is event strength; P0+ is measurable wealth effect.
5. **Can the move survive risk inspection?** Concentration, rug, wash trading, bundlers, insiders and execution liquidity.
6. **Can culture explain persistence?** Meme origin, memetic compression, remixability, community hooks and catalyst/fragility.

The first rule is a hard gate. Everything else is scoring/ranking.

## 2. Hard gate

```text
market_cap >= 1,000,000 USD
AND
(smart_money_buy_signal_count > 0 OR kol_buy_signal_count > 0)
```

No volume, price or P0 condition can override this rule.

## 3. Score features

### Identity money — dominant

- Smart Money buy: +32; repeated signals +4 each (capped).
- KOL buy: +26; repeated signals +4 each (capped).
- Smart Money + KOL together: +16.
- Current Smart Money wallet count >=3: +18; >=5: additional +6.
- Current renowned/KOL wallet count >=2: +10; >=4: additional +5.

### Buy-event context

- Large buy type 14: +8.
- Multi-wallet buy type 15: +5.
- Multi-large-buy type 16: +12.

### Newsalert P0 confirmation

- Smart Money resonance: +14 when >=3 Smart Money wallets, volume rank <=30, 5m volume >=$100k, liquidity >=$50k and risk filter passes.
- 5m volume momentum: +8 when rank <=10, volume >=$500k and 5m return >=20%.
- $5M breakout proxy: +10 when first signal market cap was below $5M, current >=$5M, rank <=20 and volume >=$100k.
- Buy-pressure confirmation: +6 when rank <=15, 5m volume >=$250k, buys >=30, buys >=2x sells and 5m return >=5%.

### Recency

- identity event <=5m: +8
- <=15m: +5
- >1h: -10

### Risk penalties

- wash trading: -35
- rug ratio >30%: -25
- Top10 >50%: -20
- bundler >30%: -15
- insider >30%: -15
- liquidity below $100k: -8

Final score is clipped to 0–100.

Grades:

- A+: >=85
- A: >=70
- B+: >=55
- B: <55

A low grade can remain visible because the hard identity gate has already been passed; this lets researchers study false positives rather than silently deleting them.

## 4. P0+ wealth-effect verification

Keep the original Newsalert wealth thresholds but lower token market-cap eligibility to $1M. This makes P0+ useful earlier in a token lifecycle without relaxing the actual wallet-profit proof.

P0+ should be treated as a *confirmed outcome feature*, not a discovery prerequisite.

## 5. Recommended v0.2 — highest-value extensions

### A. Wallet Quality Engine

Raw “Smart Money count” is too coarse. Score every Smart/KOL wallet by:

- 90d hit rate (entry -> 2h/24h positive forward return),
- median lead time before local price expansion,
- realized PnL and ROI distribution,
- median entry market cap,
- exit discipline / drawdown capture,
- independence from other wallets (funding-source and timing correlation),
- chain/category specialization.

Then use **quality-weighted identity flow**, not simple address count.

### B. Alpha Velocity

For every token persist 1m/5m/15m deltas:

- unique Smart Money buyers,
- unique KOL buyers,
- identity net-buy USD,
- new holders,
- liquidity,
- volume rank,
- buy/sell count ratio,
- market cap.

The key feature should be acceleration, e.g. `d(SM unique buyers)/dt`, not static count.

### C. Smart-leads-KOL sequence

Create lifecycle states:

```text
NEW -> SMART_ACCUMULATION -> KOL_RELAY -> CROWD_EXPANSION -> DISTRIBUTION
```

The highest-interest transition is **Smart Money enters first, then independent KOL wallets enter while liquidity expands but price has not vertically accelerated**. This is more actionable than “both are already present”.

### D. Wallet-cluster decontamination

Detect common funding source, same-block entries, repeated transaction sizing and transfer links. Ten wallets controlled by one entity should not score like ten independent buyers.

Add:

```text
independent_identity_count
cluster_adjusted_smart_flow
cluster_adjusted_kol_flow
```

### E. Meme Culture Graph

Culture should become data, not prose. Persist:

- source meme / real-world referent,
- first known account/post timestamp,
- image/phrase variants,
- unique communities repeating it,
- KOL network dispersion,
- reply/quote-to-view ratios,
- copycat token count,
- narrative half-life.

Build `Culture Velocity` and `Narrative Breadth` scores. The strongest setup is often capital entering before culture velocity becomes obvious.

### F. Execution / survival layer

Before calling anything actionable, estimate:

- $1k/$5k/$10k slippage,
- pool depth and LP concentration,
- top-holder realized selling pressure,
- developer/insider outbound transfers,
- estimated exit capacity.

A token with a high Alpha score but impossible exit liquidity should be marked “research only”.

### G. Outcome calibration / backtest

Persist every discovery event and calculate forward outcomes:

- 30m / 2h / 6h / 24h return,
- maximum favorable excursion,
- maximum adverse excursion,
- time to +20% / +50% / +100%,
- rug / liquidity-collapse outcome.

Then measure precision by score bucket and feature combination. Replace hand-set weights only after enough live samples exist.

## 6. Product surfaces after v0.1

Recommended order:

1. Persistent event database + replay.
2. Wallet Quality Engine.
3. Smart-leads-KOL lifecycle and Alpha Velocity.
4. Culture Graph.
5. Execution/slippage risk.
6. Backtest + calibrated probability: `P(+50% before -20% within 6h)`.
7. Alert policy: only A+/P0+ or state transitions, not every event.
8. Personal watchlists / annotations / post-mortems.

The end state is not another meme screener. It is an **identity-flow event engine with explainable forward-return statistics**.
