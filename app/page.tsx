"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AlphaProject, KlineCandle } from "@/lib/types";
import ContractExplorer from "./contract-explorer";
import HawkesPanel from "./hawkes-panel";
import { enrichProjectsWithIdentityHistory, loadIdentityHistory, mergeIdentityHistory, type IdentityHistoryEvent } from "./identity-history";

const STORE_KEY = "memetogo:rolling-feed:v2";
const MAX_HISTORY = 120;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

type FeedResponse = {
  generatedAt: string;
  projects: AlphaProject[];
  identityEvents?: IdentityHistoryEvent[];
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

function DetailPanel({ project, seedDetail = null, explorer = false }: { project: AlphaProject | null; seedDetail?: DetailResponse | null; explorer?: boolean }) {
  const [detail, setDetail] = useState<DetailResponse | null>(seedDetail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!project) { setDetail(null); return; }
    if (seedDetail?.explorerProject?.key === project.key) {
      setDetail(seedDetail);
      setLoading(false);
      setError("");
      return;
    }
    const ac = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/token?chain=${encodeURIComponent(project.chain)}&address=${encodeURIComponent(project.address)}`, { cache: "no-store", signal: ac.signal })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!ok) throw new Error(j.error || "详情加载失败"); setDetail(j); })
      .catch(e => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [project?.key, seedDetail]);

  if (!project) return <aside className="detail empty-detail"><div><div className="radar-orb">◎</div><h2>选择一个项目或输入合约地址</h2><p>查看K线、聪明钱/KOL信号、Hawkes传播结构、P0+财富效应、风险和梗文化。</p></div></aside>;

  const holdingCovered = !explorer || Boolean(detail?.rank);

  return <aside className="detail">
    <div className="detail-head"><div><div className="eyebrow">{explorer ? "DIRECT ANALYSIS" : "ALPHA DETAIL"}</div><h2>{project.symbol} <small>{project.name}</small></h2><div className="detail-badges"><Badge tone="smart">🧠 SM买入 {project.smartBuySignals}笔</Badge><Badge tone="kol">📣 KOL买入 {project.kolBuySignals}笔</Badge>{explorer && (detail?.gate?.eligible ? <Badge tone="smart">Gate PASS</Badge> : <Badge tone="danger">未通过 Gate</Badge>)}{project.legacyP0 && <Badge tone="hot">P0命中</Badge>}{detail?.p0Plus?.confirmed && <Badge tone="gold">P0+财富效应</Badge>}</div></div><div className="detail-score">{explorer ? <><strong>CA</strong><span>DIRECT</span></> : <><strong>{project.score}</strong><span>{project.grade}</span></>}</div></div>
    <div className="contract">{project.chain.toUpperCase()} · <code>{short(project.address)}</code> · <a href={`https://gmgn.ai/${project.chain}/token/${project.address}`} target="_blank" rel="noreferrer">GMGN ↗</a>{explorer && <span> · 主动分析，不自动进入榜单</span>}</div>
    {explorer && detail?.gate && <div className={detail.gate.eligible ? "loading" : "feed-error"}>{detail.gate.eligible ? "当前满足 $1M + Smart Money/KOL BUY 榜单硬门槛。" : `${detail.gate.marketCapEligible ? "市值门槛通过" : "市值未达 $1M"}；${detail.gate.identityEligible ? "已捕捉身份资金BUY" : "当前采集窗口未捕捉Smart Money/KOL BUY"}。`}</div>}
    {loading && <div className="loading">正在拉取K线、Top Traders 与文化研究…</div>}{error && <div className="error">{error}</div>}

    <section><div className="section-title"><h3>Meme K线</h3><span>24小时 · 5分钟</span></div><CandleChart candles={detail?.candles || []} /></section>

    <section><div className="section-title"><h3>Why Now</h3><span>资金优先</span></div><div className="why-grid"><div className="why-card smart"><b>近期SM买入</b><strong>{project.smartBuySignals}笔</strong><span>当前采集窗口BUY样本</span></div><div className="why-card kol"><b>近期KOL买入</b><strong>{project.kolBuySignals}笔</strong><span>当前采集窗口BUY样本</span></div><div className="why-card"><b>当前SM持仓</b><strong>{holdingCovered ? `${project.smartCount}钱包` : "未覆盖"}</strong><span>{holdingCovered ? "当前GMGN Rank标记持仓" : "项目不在当前Rank快照"}</span></div><div className="why-card"><b>当前KOL持仓</b><strong>{holdingCovered ? `${project.kolCount}钱包` : "未覆盖"}</strong><span>{holdingCovered ? "当前GMGN Rank标记持仓" : "项目不在当前Rank快照"}</span></div></div><p className="muted">口径：买入笔数 = MemeToGo 当前身份资金采集窗口中的 GMGN BUY 交易记录；持仓钱包数来自当前 GMGN Rank 快照。主动查询项目若不在 Rank 中，会显示“未覆盖”，不能解释为 0 钱包。</p><ul className="compact-list">{project.thesis.map((x, i) => <li key={i}>{x}</li>)}</ul></section>

    <HawkesPanel project={project} />

    <section><div className="section-title"><h3>P0 / P0+ 验证</h3><span>核心强度 / 财富效应</span></div><div className="p0-box"><div><b>P0</b><span>{project.legacyP0 ? "命中" : "未命中"}</span></div><p>{project.legacyP0Reasons.join("；") || (explorer ? "当前主动分析未命中可验证的 P0 强度条件；不影响继续查看 P0+、风险与 Hawkes。" : "当前仅满足Smart/KOL硬门槛，尚无P0强度条件。")}</p></div><div className={`p0-box ${detail?.p0Plus?.confirmed ? "confirmed" : ""}`}><div><b>P0+</b><span>{detail?.p0Plus?.confirmed ? "确认" : "观察"}</span></div><p>{detail?.p0Plus?.reason || "加载后验证Top Trader财富效应"}</p>{detail?.p0Plus?.stories?.map((s: any, i: number) => <div className="wealth-story" key={i}><span>{s.label}</span><b>{money(s.profit)} / {s.roi.toFixed(1)}x</b><code>{short(s.wallet)}</code></div>)}</div></section>

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
  const [explorerProject, setExplorerProject] = useState<AlphaProject | null>(null);
  const [explorerDetail, setExplorerDetail] = useState<DetailResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/feed", { cache: "no-store" });
      const data: FeedResponse = await r.json();
      if (!r.ok) throw new Error(data.error || "Feed加载失败");
      const history = mergeIdentityHistory(loadIdentityHistory(), data.identityEvents || []);
      const incoming = enrichProjectsWithIdentityHistory(data.projects || [], history);
      setProjects(prev => {
        const merged = enrichProjectsWithIdentityHistory(mergeRolling(prev, incoming), history);
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
      const history = loadIdentityHistory();
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      if (Array.isArray(saved)) setProjects(enrichProjectsWithIdentityHistory(mergeRolling([], saved), history));
    } catch { /* ignore stale local cache */ }
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const visible = useMemo(() => projects.filter(p =>
    (chain === "all" || p.chain === chain) &&
    (identity === "all" || (identity === "both" ? p.smartBuySignals > 0 && p.kolBuySignals > 0 : identity === "smart" ? p.smartBuySignals > 0 : p.kolBuySignals > 0))
  ), [projects, chain, identity]);

  const explorerSelected = Boolean(explorerProject && explorerProject.key === selected);
  const selectedProject = explorerSelected ? explorerProject : projects.find(p => p.key === selected) || null;
  const stats = useMemo(() => ({
    a: projects.filter(p => p.grade === "A+").length,
    p0: projects.filter(p => p.legacyP0).length,
    both: projects.filter(p => p.smartBuySignals && p.kolBuySignals).length,
  }), [projects]);

  return <main>
    <header className="topbar"><div><div className="brand"><span className="brand-mark">M</span><strong>MemeToGo</strong><em>Alpha Radar</em></div><p>Smart Money / KOL First · 先看谁在买，再看价格为什么动</p><p><b>筛选机制：</b>GMGN 实时捕捉 Smart Money / KOL 的真实 BUY，身份资金事件可在低市值阶段先记录；只有项目当前市值 ≥ $1M 才允许上榜，无 Smart Money/KOL 买入直接淘汰。通过硬门槛后，再按身份资金强度 → P0 强度 → 5分钟成交/流动性等市场微结构 → 风险惩罚计算 Alpha Score 并排序。<br /><b>P0：</b>确认行情与资金强度，重点观察聪明钱共振、爆量/买压、市值关键突破及大额或多钱包买入。 <b>P0+：</b>进一步确认高质量获利钱包是否形成财富效应，综合 Top Trader 的利润、ROI 与多钱包共振判断。</p></div><div className="live"><span className="live-dot" /><div><b>LIVE</b><small>{lastAt ? new Date(lastAt).toLocaleTimeString("zh-CN", { hour12: false }) : "连接中"}</small></div></div></header>
    <div className="gatebar"><span>硬门槛</span><b>市值 ≥ $1M</b><b>必须 Smart Money 或 KOL 买入</b><b>15秒刷新</b><span className="gate-note">无身份资金买入 = 不上榜</span></div>
    <div className="dashboard"><section className="feed"><div className="feed-head"><div><div className="eyebrow">ROLLING ALPHA FEED</div><h1>链上 Alpha 项目流</h1></div><div className="mini-stats"><div><b>{projects.length}</b><span>12H项目</span></div><div><b>{stats.a}</b><span>A+</span></div><div><b>{stats.both}</b><span>双共振</span></div><div><b>{stats.p0}</b><span>P0</span></div></div></div>
      <ContractExplorer onAnalyzed={(project, detail) => { const enriched = enrichProjectsWithIdentityHistory([project], loadIdentityHistory())[0] || project; setExplorerProject(enriched); setExplorerDetail(detail); setSelected(enriched.key); }} />
      <div className="filters"><div>{["all", "sol", "bsc", "robinhood"].map(v => <button key={v} className={chain === v ? "active" : ""} onClick={() => setChain(v)}>{v === "all" ? "全部链" : v.toUpperCase()}</button>)}</div><div>{[["all", "全部身份"], ["both", "SM+KOL"], ["smart", "聪明钱"], ["kol", "KOL"]].map(([v, l]) => <button key={v} className={identity === v ? "active" : ""} onClick={() => setIdentity(v)}>{l}</button>)}</div></div>
      {error && <div className="feed-error">{error}</div>}{loading && !projects.length ? <div className="loading feed-loading">正在建立身份资金雷达…</div> : visible.length ? <div className="project-list">{visible.map(p => <ProjectRow key={p.key} project={p} selected={selected === p.key} onClick={() => setSelected(p.key)} />)}</div> : <div className="no-results"><div>∅</div><h3>当前没有项目通过硬门槛</h3><p>这是正常状态：宁可空窗，也不把没有聪明钱/KOL买入的纯拉盘塞进来。</p></div>}
    </section><DetailPanel project={selectedProject} seedDetail={explorerSelected ? explorerDetail : null} explorer={explorerSelected} /></div>
    <footer>研究工具，不构成投资建议 · 排序优先级：身份资金 → P0强度 → 市场微结构 → 风险惩罚</footer>
  </main>;
}
