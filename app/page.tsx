"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AlphaProject, HawkesMetrics, KlineCandle } from "@/lib/types";
import styles from "./hawkes.module.css";

const STORE_KEY = "memetogo:rolling-feed:v2";
const MAX_HISTORY = 120;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

type FeedResponse = {
  generatedAt: string;
  projects: AlphaProject[];
  diagnostics?: Array<{ chain: string; errors: string[] }>;
  error?: string;
};
type DetailResponse = any;

const money = (n: number) => !n ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const ago = (epoch: number) => {
  const s = Math.max(0, Date.now() / 1000 - epoch);
  return s < 60 ? `${Math.floor(s)}秒前` : s < 3600 ? `${Math.floor(s / 60)}分钟前` : `${Math.floor(s / 3600)}小时前`;
};
const short = (s: string) => s.length > 16 ? `${s.slice(0, 7)}…${s.slice(-5)}` : s;

function mergeRolling(previous: AlphaProject[], incoming: AlphaProject[]) {
  const map = new Map<string, AlphaProject>();
  for (const row of [...incoming, ...previous]) {
    const old = map.get(row.key);
    if (!old || row.latestSignalEpoch > old.latestSignalEpoch || row.score > old.score) map.set(row.key, row);
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  return [...map.values()]
    .filter(row => row.latestSignalEpoch * 1000 >= cutoff)
    .sort((a, b) => b.score - a.score || b.latestSignalEpoch - a.latestSignalEpoch)
    .slice(0, MAX_HISTORY);
}

function CandleChart({ candles }: { candles: KlineCandle[] }) {
  if (!candles?.length) return <div className="chart-empty">暂无K线数据</div>;
  const width = 920, height = 300, pad = 22;
  const min = Math.min(...candles.map(c => c.low));
  const max = Math.max(...candles.map(c => c.high));
  const range = Math.max(max - min, max * .001, 1e-12);
  const x = (i: number) => pad + i * ((width - pad * 2) / Math.max(1, candles.length - 1));
  const y = (p: number) => height - pad - ((p - min) / range) * (height - pad * 2);
  const candleWidth = Math.max(1, Math.min(6, (width - pad * 2) / candles.length * .65));

  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24小时5分钟K线">
    {[.25, .5, .75].map(v => <line key={v} x1={pad} x2={width - pad} y1={height * v} y2={height * v} className="grid-line" />)}
    {candles.map((c, i) => {
      const up = c.close >= c.open;
      const cx = x(i), yo = y(c.open), yc = y(c.close), yh = y(c.high), yl = y(c.low);
      return <g key={`${c.time}-${i}`} className={up ? "candle-up" : "candle-down"}>
        <line x1={cx} x2={cx} y1={yh} y2={yl} />
        <rect x={cx - candleWidth / 2} y={Math.min(yo, yc)} width={candleWidth} height={Math.max(1, Math.abs(yc - yo))} />
      </g>;
    })}
  </svg><div className="chart-labels"><span>24H / 5m</span><span>Low {min.toPrecision(4)} · High {max.toPrecision(4)}</span></div></div>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const regimeLabels: Record<HawkesMetrics["regime"], string> = {
  insufficient: "样本不足",
  dormant: "未启动",
  upstream_ignition: "上游点火",
  cascade: "级联形成",
  overheated: "传播过热",
};

const confidenceLabels: Record<HawkesMetrics["confidence"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function hawkesOutlook(project: AlphaProject) {
  const h = project.hawkes;
  if (!h || h.eventCount < 2) {
    return {
      bias: "暂不判断",
      tone: "neutral",
      structure: "身份资金事件样本不足，当前无法稳定分解外生流入与内生传播。",
      outlook: "后市方向暂不应由 Hawkes 模型决定；等待更多 Smart Money / KOL BUY 事件进入窗口后再观察。",
      confirm: "至少形成 2 个以上时序事件，最好同时包含 SM 与 KOL，再观察传播矩阵是否稳定。",
      invalidation: "当前无有效 Hawkes 结构，因此不存在模型意义上的失效条件。",
    };
  }

  const rho = h.reproductionNumber;
  const endo = h.endogenousRatio;
  const smLead = h.smartToKol > h.kolToSmart * 1.2;
  const kolLead = h.kolToSmart > h.smartToKol * 1.2;
  const priceExtended = project.change5m >= 20;
  const weakLiquidity = project.liquidity > 0 && project.liquidity < 100_000;

  if (h.regime === "overheated") {
    return {
      bias: "高波动 · 谨慎追涨",
      tone: "risk",
      structure: `ρ(A)=${rho.toFixed(2)}、内生传播 ${(endo * 100).toFixed(0)}%，说明事件已经高度依赖前序事件自我繁殖，系统接近或进入临界传播。`,
      outlook: `短线动量仍可能延续，但这已经不是最优早期 Alpha 区间。${priceExtended ? "5分钟价格已经明显加速，传播与价格同时过热，追高后的回撤风险更高。" : "价格尚未完全垂直化，但资金传播拥挤度已经很高，后续波动会显著放大。"}`,
      confirm: "更健康的续涨需要 ρ 从极端位置回落但价格、流动性和身份资金仍保持抬升，即由‘爆炸式传播’转成‘可持续趋势’。",
      invalidation: "若身份资金事件骤停、内生率快速回落，同时价格跌破最近传播启动区，则级联大概率进入衰减。",
    };
  }

  if (h.regime === "upstream_ignition") {
    return {
      bias: priceExtended ? "偏多 · 但已开始兑现" : "偏多 · 早期传播",
      tone: "bull",
      structure: `SM→KOL=${h.smartToKol.toFixed(2)} 高于 KOL→SM=${h.kolToSmart.toFixed(2)}，说明传播方向更接近“聪明钱先进入 → KOL 后接力”，属于理想的上游点火结构。`,
      outlook: `${priceExtended ? "资金传播结构仍偏正面，但价格已快速反应，新增赔率低于信号刚启动时。" : "价格尚未大幅兑现时，这类结构最符合早期 Alpha：资金关系先变化、价格随后才可能完成扩散。"}${weakLiquidity ? "不过当前流动性偏薄，价格冲击可能放大 Hawkes 信号，需要防止把机械拉盘误判成信息扩散。" : ""}`,
      confirm: "SM→KOL 继续抬升、ρ 向 0.6–0.9 区间上行，同时 KOL 买入数量和成交量扩张，但价格仍未出现单根垂直拉升，是最强确认。",
      invalidation: "若 SM→KOL 快速回落、KOL→SM 反超，或 ρ 回落到约 0.3 以下，说明上游传播没有成功转化成持续级联。",
    };
  }

  if (h.regime === "cascade") {
    if (smLead) {
      return {
        bias: priceExtended ? "偏多 · 传播中段" : "偏多 · 级联扩散",
        tone: "bull",
        structure: `ρ(A)=${rho.toFixed(2)}、内生率 ${(endo * 100).toFixed(0)}%，传播已形成自激；同时 SM→KOL 仍强于反向路径，资金链条仍偏上游驱动。`,
        outlook: `${priceExtended ? "趋势延续概率仍高于普通项目，但行情已经进入传播中段，最早期赔率已经下降。" : "级联已启动但价格尚未充分扩张，后续更值得观察 KOL 接力和成交扩张是否继续把身份资金传播到更广泛市场。"}`,
        confirm: "ρ 维持在亚临界高位、内生率继续抬升，且 SM→KOL 不弱化，是延续级联的主要确认。",
        invalidation: "ρ 与内生率同时下降、SM→KOL 转弱并伴随成交量衰减，说明传播链正在失去自我维持能力。",
      };
    }
    if (kolLead) {
      return {
        bias: "中性偏谨慎 · KOL主导",
        tone: "warn",
        structure: `虽然 ρ(A)=${rho.toFixed(2)} 已显示级联，但 KOL→SM=${h.kolToSmart.toFixed(2)} 高于 SM→KOL=${h.smartToKol.toFixed(2)}，传播更像 KOL/市场热度领先、聪明钱随后参与。`,
        outlook: "这类结构可以继续上涨，但‘早期信息优势’弱于 Smart Money 上游点火，更接近已经被市场发现后的扩散。若价格同时快速上涨，应降低追高权重。",
        confirm: "若后续 SM→KOL 反超 KOL→SM，说明聪明钱开始重新取得传播上游位置，结构才会明显改善。",
        invalidation: "若 KOL 自激继续升高而 SM 跟随减弱，同时价格加速，容易演化成情绪主导的后段行情。",
      };
    }
    return {
      bias: "中性偏多 · 双向自激",
      tone: "neutral",
      structure: `ρ(A)=${rho.toFixed(2)}、内生率 ${(endo * 100).toFixed(0)}%，SM 与 KOL 之间没有明显单向领先，属于双向互相强化的传播结构。`,
      outlook: "行情已有持续性基础，但缺少明确的上游信息源，因此更像趋势确认而不是最早期 Alpha。需要结合价格是否已充分拉升判断赔率。",
      confirm: "若 SM→KOL 开始持续高于反向路径，同时 ρ 继续上升但保持低于临界区，结构会进一步转强。",
      invalidation: "双向激发同时下降、内生率回落，意味着传播网络开始解耦，趋势延续概率下降。",
    };
  }

  return {
    bias: "中性 · 尚未形成自激",
    tone: "neutral",
    structure: `ρ(A)=${rho.toFixed(2)}、内生率 ${(endo * 100).toFixed(0)}%，身份资金事件仍以外生、离散到达为主，尚未形成稳定的自我传播。`,
    outlook: "当前有 Smart Money/KOL 买入并不等于形成 Alpha 级联。后市更依赖新的独立身份资金事件是否连续出现；在 Hawkes 结构转强前，不应仅凭单笔身份资金追涨。",
    confirm: "ρ 上升到约 0.4 以上、内生率抬升，并出现明确 SM→KOL 或持续 SM→SM 自激，才说明资金结构开始真正变化。",
    invalidation: "若后续仍只有零散事件、ρ 长期低位，则本轮身份资金更可能只是孤立交易，而非可传播 Alpha。",
  };
}

function HawkesPanel({ project }: { project: AlphaProject }) {
  const h = project.hawkes;
  const view = hawkesOutlook(project);
  if (!h) return <section><div className="section-title"><h3>Hawkes 传播结构</h3><span>等待模型数据</span></div><p className="muted">该项目尚未生成 Hawkes 数据。</p></section>;

  return <section className={styles.section}>
    <div className="section-title"><h3>Hawkes 传播结构</h3><span>Marked Multivariate · 2H窗口 · 15m核半衰期</span></div>
    <div className={styles.statusRow}>
      <span className={`${styles.regime} ${styles[view.tone]}`}>{regimeLabels[h.regime]}</span>
      <span>后市倾向：<b>{view.bias}</b></span>
      <span>置信度：<b>{confidenceLabels[h.confidence]}</b></span>
      <span>样本：<b>{h.eventCount}</b>（SM {h.smartEvents} / KOL {h.kolEvents}）</span>
      <span>金额Mark覆盖：<b>{(h.markCoverage * 100).toFixed(0)}%</b></span>
    </div>

    <div className={styles.cards}>
      <div className={styles.card}><span>ρ(A) 传播再生产数</span><strong>{h.reproductionNumber.toFixed(2)}</strong><small>{h.reproductionNumber < .4 ? "传播弱" : h.reproductionNumber < .8 ? "自激增强" : h.reproductionNumber < .95 ? "接近临界" : "临界/过热"}</small></div>
      <div className={styles.card}><span>内生传播占比</span><strong>{(h.endogenousRatio * 100).toFixed(0)}%</strong><small>被前序事件解释的比例</small></div>
      <div className={`${styles.card} ${styles.smart}`}><span>SM → KOL</span><strong>{h.smartToKol.toFixed(2)}</strong><small>聪明钱对KOL的激发</small></div>
      <div className={`${styles.card} ${styles.kol}`}><span>KOL → SM</span><strong>{h.kolToSmart.toFixed(2)}</strong><small>KOL对聪明钱的反向激发</small></div>
    </div>

    <div className={styles.matrixLine}>
      <span>SM→SM <b>{h.smartToSmart.toFixed(2)}</b></span>
      <span>KOL→KOL <b>{h.kolToKol.toFixed(2)}</b></span>
      <span>方向优势 <b>{h.directionalEdge >= 0 ? "+" : ""}{h.directionalEdge.toFixed(2)}</b></span>
      <span>ρ&lt;1 为亚临界；越接近 1，传播越容易自我维持</span>
    </div>

    <div className={styles.reading}>
      <div><span>当前结构</span><p>{view.structure}</p></div>
      <div className={styles.outlook}><span>行情后市判断</span><p>{view.outlook}</p></div>
      <div><span>继续走强的确认条件</span><p>{view.confirm}</p></div>
      <div><span>结构失效 / 风险信号</span><p>{view.invalidation}</p></div>
    </div>

    <p className={styles.note}>读法：ρ(A) 衡量整个身份资金网络的自激繁殖能力；SM→KOL 与 KOL→SM 判断传播方向；内生率判断当前交易有多少是由前序身份资金事件“带出来”的。该模块暂不参与 Alpha Score，先独立观察其对后续行情的解释力。</p>
  </section>;
}

function ProjectRow({ project, selected, onClick }: { project: AlphaProject; selected: boolean; onClick: () => void }) {
  return <button className={`project-row ${selected ? "selected" : ""}`} onClick={onClick}>
    <div className="rank-score"><strong>{project.score}</strong><span>{project.grade}</span></div>
    <div className="project-main">
      <div className="project-title"><strong>{project.symbol}</strong><span>{project.name}</span><Badge>{project.chain.toUpperCase()}</Badge>{project.legacyP0 && <Badge tone="hot">P0</Badge>}</div>
      <div className="identity-flow"><Badge tone="smart">🧠 近期SM买入 {project.smartBuySignals}笔</Badge><Badge tone="kol">📣 近期KOL买入 {project.kolBuySignals}笔</Badge>{project.smartCount > 0 && <span>当前SM持仓 {project.smartCount}钱包</span>}{project.kolCount > 0 && <span>当前KOL持仓 {project.kolCount}钱包</span>}</div>
      <div className="metrics"><span>市值 <b>{money(project.marketCap)}</b></span><span>流动性 <b>{money(project.liquidity)}</b></span><span>5m成交 <b>{money(project.volume5m)}</b></span><span className={project.change5m >= 0 ? "positive" : "negative"}>5m {pct(project.change5m)}</span><span>#{project.rank}</span></div>
      <div className="thesis-line">{project.thesis.slice(0, 3).join(" · ") || "身份资金信号已通过硬门槛"}</div>
      {!!project.risks.length && <div className="risk-line">⚠ {project.risks.join(" · ")}</div>}
    </div>
    <div className="row-time">{ago(project.latestSignalEpoch)}<span>›</span></div>
  </button>;
}

function DetailPanel({ project }: { project: AlphaProject | null }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!project) { setDetail(null); return; }
    const ac = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/token?chain=${encodeURIComponent(project.chain)}&address=${encodeURIComponent(project.address)}`, { cache: "no-store", signal: ac.signal })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!ok) throw new Error(j.error || "详情加载失败"); setDetail(j); })
      .catch(e => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [project?.key]);

  if (!project) return <aside className="detail empty-detail"><div><div className="radar-orb">◎</div><h2>选择一个项目</h2><p>查看K线、聪明钱/KOL信号、Hawkes传播结构、P0+财富效应、风险和梗文化。</p></div></aside>;

  return <aside className="detail">
    <div className="detail-head"><div><div className="eyebrow">ALPHA DETAIL</div><h2>{project.symbol} <small>{project.name}</small></h2><div className="detail-badges"><Badge tone="smart">🧠 SM买入 {project.smartBuySignals}笔</Badge><Badge tone="kol">📣 KOL买入 {project.kolBuySignals}笔</Badge>{project.legacyP0 && <Badge tone="hot">P0命中</Badge>}{detail?.p0Plus?.confirmed && <Badge tone="gold">P0+财富效应</Badge>}</div></div><div className="detail-score"><strong>{project.score}</strong><span>{project.grade}</span></div></div>
    <div className="contract">{project.chain.toUpperCase()} · <code>{short(project.address)}</code> · <a href={`https://gmgn.ai/${project.chain}/token/${project.address}`} target="_blank" rel="noreferrer">GMGN ↗</a></div>
    {loading && <div className="loading">正在拉取K线、Top Traders 与文化研究…</div>}{error && <div className="error">{error}</div>}

    <section><div className="section-title"><h3>Meme K线</h3><span>24小时 · 5分钟</span></div><CandleChart candles={detail?.candles || []} /></section>

    <section><div className="section-title"><h3>Why Now</h3><span>资金优先</span></div><div className="why-grid"><div className="why-card smart"><b>近期SM买入</b><strong>{project.smartBuySignals}笔</strong><span>最新身份资金BUY样本</span></div><div className="why-card kol"><b>近期KOL买入</b><strong>{project.kolBuySignals}笔</strong><span>最新身份资金BUY样本</span></div><div className="why-card"><b>当前SM持仓</b><strong>{project.smartCount}钱包</strong><span>当前GMGN标记持仓</span></div><div className="why-card"><b>当前KOL持仓</b><strong>{project.kolCount}钱包</strong><span>当前GMGN标记持仓</span></div></div><p className="muted">口径：买入笔数 = GMGN近期身份资金BUY交易记录；持仓钱包数 = 当前仍持有该项目的GMGN标记钱包数量，两者不是同一指标。</p><ul className="compact-list">{project.thesis.map((x, i) => <li key={i}>{x}</li>)}</ul></section>

    <HawkesPanel project={project} />

    <section><div className="section-title"><h3>P0 / P0+ 验证</h3><span>核心强度 / 财富效应</span></div><div className="p0-box"><div><b>P0</b><span>{project.legacyP0 ? "命中" : "未命中"}</span></div><p>{project.legacyP0Reasons.join("；") || "当前仅满足Smart/KOL硬门槛，尚无P0强度条件。"}</p></div><div className={`p0-box ${detail?.p0Plus?.confirmed ? "confirmed" : ""}`}><div><b>P0+</b><span>{detail?.p0Plus?.confirmed ? "确认" : "观察"}</span></div><p>{detail?.p0Plus?.reason || "加载后验证Top Trader财富效应"}</p>{detail?.p0Plus?.stories?.map((s: any, i: number) => <div className="wealth-story" key={i}><span>{s.label}</span><b>{money(s.profit)} / {s.roi.toFixed(1)}x</b><code>{short(s.wallet)}</code></div>)}</div></section>

    <section><div className="section-title"><h3>梗文化与传播机制</h3><span>证据约束</span></div>{detail?.culture ? <div className="culture"><p className="culture-summary">{detail.culture.summary}</p><dl><dt>起源</dt><dd>{detail.culture.origin}</dd><dt>为什么能传播</dt><dd>{detail.culture.memeMechanism}</dd><dt>社区钩子</dt><dd>{detail.culture.communityHooks?.join(" · ") || "待核验"}</dd><dt>催化剂</dt><dd>{detail.culture.catalysts?.join(" · ") || "待核验"}</dd><dt>脆弱点</dt><dd>{detail.culture.fragility?.join(" · ") || "待核验"}</dd></dl><div className="confidence">研究置信度：{detail.culture.confidence}</div></div> : <div className="skeleton-block" />}</section>

    <section><div className="section-title"><h3>Top Traders</h3><span>利润 / 浮盈合并</span></div><div className="trader-table"><div className="trader-head"><span>钱包</span><span>成本</span><span>总利润</span><span>ROI</span></div>{detail?.traders?.slice(0, 8).map((t: any, i: number) => <div className="trader-row" key={i}><span><code>{short(t.address)}</code>{t.tags?.length ? <small>{t.tags.slice(0, 2).join("/")}</small> : null}</span><span>{money(t.cost)}</span><span className={t.totalProfit >= 0 ? "positive" : "negative"}>{money(t.totalProfit)}</span><span>{t.totalRoi?.toFixed(1)}x</span></div>)}</div></section>

    <section><div className="section-title"><h3>风险雷达</h3><span>不因有聪明钱而豁免</span></div>{project.risks.length ? <div className="risk-cards">{project.risks.map((x, i) => <Badge key={i} tone="danger">{x}</Badge>)}</div> : <p className="muted">未触发现有高风险阈值；仍需检查合约、池子与同源钱包。</p>}</section>
  </aside>;
}

export default function Home() {
  const [projects, setProjects] = useState<AlphaProject[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastAt, setLastAt] = useState("");
  const [chain, setChain] = useState("all");
  const [identity, setIdentity] = useState("all");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/feed", { cache: "no-store" });
      const data: FeedResponse = await r.json();
      if (!r.ok) throw new Error(data.error || "Feed加载失败");
      setProjects(prev => {
        const merged = mergeRolling(prev, data.projects || []);
        localStorage.setItem(STORE_KEY, JSON.stringify(merged));
        return merged;
      });
      setLastAt(data.generatedAt);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      if (Array.isArray(saved)) setProjects(mergeRolling([], saved));
    } catch { /* ignore stale local cache */ }
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const visible = useMemo(() => projects.filter(p =>
    (chain === "all" || p.chain === chain) &&
    (identity === "all" || (identity === "both" ? p.smartBuySignals > 0 && p.kolBuySignals > 0 : identity === "smart" ? p.smartBuySignals > 0 : p.kolBuySignals > 0))
  ), [projects, chain, identity]);

  const selectedProject = projects.find(p => p.key === selected) || null;
  const stats = useMemo(() => ({
    a: projects.filter(p => p.grade === "A+").length,
    p0: projects.filter(p => p.legacyP0).length,
    both: projects.filter(p => p.smartBuySignals && p.kolBuySignals).length,
  }), [projects]);

  return <main>
    <header className="topbar"><div><div className="brand"><span className="brand-mark">M</span><strong>MemeToGo</strong><em>Alpha Radar</em></div><p>Smart Money / KOL First · 先看谁在买，再看价格为什么动</p><p><b>筛选机制：</b>GMGN 实时捕捉 Smart Money / KOL 的真实 BUY，身份资金事件可在低市值阶段先记录；只有项目当前市值 ≥ $1M 才允许上榜，无 Smart Money/KOL 买入直接淘汰。通过硬门槛后，再按身份资金强度 → P0 强度 → 5分钟成交/流动性等市场微结构 → 风险惩罚计算 Alpha Score 并排序。<br /><b>P0：</b>确认行情与资金强度，重点观察聪明钱共振、爆量/买压、市值关键突破及大额或多钱包买入。 <b>P0+：</b>进一步确认高质量获利钱包是否形成财富效应，综合 Top Trader 的利润、ROI 与多钱包共振判断。</p></div><div className="live"><span className="live-dot" /><div><b>LIVE</b><small>{lastAt ? new Date(lastAt).toLocaleTimeString("zh-CN", { hour12: false }) : "连接中"}</small></div></div></header>
    <div className="gatebar"><span>硬门槛</span><b>市值 ≥ $1M</b><b>必须 Smart Money 或 KOL 买入</b><b>15秒刷新</b><span className="gate-note">无身份资金买入 = 不上榜</span></div>
    <div className="dashboard"><section className="feed"><div className="feed-head"><div><div className="eyebrow">ROLLING ALPHA FEED</div><h1>链上 Alpha 项目流</h1></div><div className="mini-stats"><div><b>{projects.length}</b><span>12H项目</span></div><div><b>{stats.a}</b><span>A+</span></div><div><b>{stats.both}</b><span>双共振</span></div><div><b>{stats.p0}</b><span>P0</span></div></div></div>
      <div className="filters"><div>{["all", "sol", "bsc", "robinhood"].map(v => <button key={v} className={chain === v ? "active" : ""} onClick={() => setChain(v)}>{v === "all" ? "全部链" : v.toUpperCase()}</button>)}</div><div>{[["all", "全部身份"], ["both", "SM+KOL"], ["smart", "聪明钱"], ["kol", "KOL"]].map(([v, l]) => <button key={v} className={identity === v ? "active" : ""} onClick={() => setIdentity(v)}>{l}</button>)}</div></div>
      {error && <div className="feed-error">{error}</div>}{loading && !projects.length ? <div className="loading feed-loading">正在建立身份资金雷达…</div> : visible.length ? <div className="project-list">{visible.map(p => <ProjectRow key={p.key} project={p} selected={selected === p.key} onClick={() => setSelected(p.key)} />)}</div> : <div className="no-results"><div>∅</div><h3>当前没有项目通过硬门槛</h3><p>这是正常状态：宁可空窗，也不把没有聪明钱/KOL买入的纯拉盘塞进来。</p></div>}
    </section><DetailPanel project={selectedProject} /></div>
    <footer>研究工具，不构成投资建议 · 排序优先级：身份资金 → P0强度 → 市场微结构 → 风险惩罚</footer>
  </main>;
}
