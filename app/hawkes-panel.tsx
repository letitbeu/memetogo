"use client";

import type { AlphaProject, HawkesMetrics } from "@/lib/types";
import styles from "./hawkes.module.css";

const regimeLabels: Record<HawkesMetrics["regime"], string> = {
  insufficient: "无事件",
  seed: "种子态",
  unilateral: "单边积累",
  dormant: "未形成自激",
  upstream_ignition: "上游点火",
  cascade: "级联形成",
  overheated: "传播过热",
};

const confidenceLabels: Record<HawkesMetrics["confidence"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function outlook(project: AlphaProject) {
  const h = project.hawkes;
  if (!h || h.eventCount === 0) {
    return {
      bias: "暂不判断",
      tone: "neutral",
      structure: "当前自适应窗口内没有可用的 Smart Money / KOL BUY 事件。",
      outlook: "Hawkes 无法在没有事件的情况下推断传播结构；此时应以其他模块为主。",
      confirm: "出现首个 Smart Money 或 KOL BUY 后，模型会进入种子态并开始给出后验预测。",
      invalidation: "当前没有有效传播信号。",
    };
  }

  const rho = h.reproductionNumber;
  const endo = h.endogenousRatio;
  const evidence = h.localEvidenceWeight;
  const forecast = h.expectedTriggered60m;
  const smLead = h.smartToKol > h.kolToSmart * 1.2;
  const kolLead = h.kolToSmart > h.smartToKol * 1.2;
  const priceExtended = project.change5m >= 20;
  const weakLiquidity = project.liquidity > 0 && project.liquidity < 100_000;

  if (h.regime === "seed") {
    const smartSeed = h.latestEventType === "smart";
    return {
      bias: smartSeed ? "观察偏多 · SM种子" : "中性观察 · KOL种子",
      tone: smartSeed ? "bull" : "warn",
      structure: `当前只有 1 个${smartSeed ? " Smart Money" : " KOL"} BUY 事件，因此尚无项目自身的父子事件对；ρ(A)=${rho.toFixed(2)} 主要来自贝叶斯先验与当前事件暴露，本地激发证据权重为 ${(evidence * 100).toFixed(0)}%。`,
      outlook: smartSeed
        ? `这不是“确认上涨”，而是最早期种子信号。按当前后验，最新事件未来60分钟预计诱发约 ${forecast.toFixed(2)} 个后续身份事件；若很快出现第二个独立 SM 或 KOL 接力，信号会从种子态升级。`
        : `KOL 单点先行的信息质量弱于 Smart Money 种子。当前未来60分钟条件触发预期约 ${forecast.toFixed(2)} 个身份事件；更值得等待 Smart Money 响应，而不是仅凭单个 KOL 事件追涨。`,
      confirm: smartSeed
        ? "60分钟内出现新的独立 SM 买入，或 KOL 首次接力，同时成交和流动性不恶化，是种子成功发芽的第一确认。"
        : "若后续出现 Smart Money 跟随，并且 SM→KOL / SM→SM 开始抬升，KOL 种子才会转化为更高质量结构。",
      invalidation: "若一个核半衰期到数个半衰期内没有任何后续身份事件，条件强度会自然衰减，种子信号失效。",
    };
  }

  if (h.regime === "unilateral") {
    const smartOnly = h.smartEvents > 0 && h.kolEvents === 0;
    return {
      bias: smartOnly ? "偏多观察 · SM单边积累" : "中性偏谨慎 · KOL单边积累",
      tone: smartOnly ? "bull" : "warn",
      structure: `窗口内已有 ${h.eventCount} 个事件，但目前只来自${smartOnly ? " Smart Money" : " KOL"} 一侧。ρ(A)=${rho.toFixed(2)}、内生率 ${(endo * 100).toFixed(0)}%、本地证据权重 ${(evidence * 100).toFixed(0)}%，说明可以估计单边自激，但跨群体传播尚未被观测确认。`,
      outlook: smartOnly
        ? `连续 Smart Money 进入比单笔信号更有意义，尤其当 SM→SM 抬升时，代表同类高质量资金正在形成自激。未来60分钟条件触发预期约 ${forecast.toFixed(2)}；若随后出现 KOL 接力，往往是传播从“积累”向“扩散”升级的关键。`
        : `连续 KOL 买入能制造传播，但缺乏 Smart Money 上游确认时，更像叙事/情绪驱动。未来60分钟条件触发预期约 ${forecast.toFixed(2)}；若价格已经快速拉升，追高赔率通常较差。`,
      confirm: smartOnly
        ? "KOL 首次接力、SM→KOL 上升且 ρ 保持亚临界上行，是从单边积累转向健康级联的确认。"
        : "Smart Money 开始响应并形成 KOL→SM 后的二次 SM→KOL 反馈，才说明传播不只是单向情绪放大。",
      invalidation: "若同类事件停止、ρ 与条件触发预期同步下降，说明单边资金并未形成可持续传播。",
    };
  }

  if (h.regime === "overheated") {
    return {
      bias: "高波动 · 谨慎追涨",
      tone: "risk",
      structure: `ρ(A)=${rho.toFixed(2)}、内生传播 ${(endo * 100).toFixed(0)}%，说明事件已经高度依赖前序事件自我繁殖，系统接近或进入临界传播。`,
      outlook: `短线动量仍可能延续，但这通常已经不是最优早期 Alpha 区间。${priceExtended ? "5分钟价格同时明显加速，传播与价格共振过热，追高后回撤风险更高。" : "价格尚未完全垂直化，但资金传播拥挤度已经很高，后续波动会显著放大。"}`,
      confirm: "更健康的续涨需要 ρ 从极端位置回落但价格、流动性和身份资金仍保持抬升，即由爆炸式传播转成可持续趋势。",
      invalidation: "若身份资金事件骤停、内生率快速回落，同时价格跌破最近传播启动区，则级联大概率进入衰减。",
    };
  }

  if (h.regime === "upstream_ignition") {
    return {
      bias: priceExtended ? "偏多 · 但已开始兑现" : "偏多 · 早期传播",
      tone: "bull",
      structure: `SM→KOL=${h.smartToKol.toFixed(2)} 高于 KOL→SM=${h.kolToSmart.toFixed(2)}，说明传播更接近“聪明钱先进入 → KOL 后接力”。本地证据权重 ${(evidence * 100).toFixed(0)}%。`,
      outlook: `${priceExtended ? "资金传播仍偏正面，但价格已经快速反应，新增赔率低于刚点火时。" : "价格尚未大幅兑现时，这是最符合 Early Alpha 的结构：资金关系先变化，价格可能随后完成扩散。"}${weakLiquidity ? " 当前流动性偏薄，需防止机械价格冲击放大 Hawkes 信号。" : ""}`,
      confirm: "SM→KOL 继续抬升、ρ 向 0.6–0.9 区间上行，同时 KOL 买入和成交扩张但价格尚未垂直拉升，是更强确认。",
      invalidation: "若 SM→KOL 快速回落、KOL→SM 反超，或 ρ 回落到约 0.3 以下，说明上游点火没有成功转化为持续级联。",
    };
  }

  if (h.regime === "cascade") {
    if (smLead) {
      return {
        bias: priceExtended ? "偏多 · 传播中段" : "偏多 · 级联扩散",
        tone: "bull",
        structure: `ρ(A)=${rho.toFixed(2)}、内生率 ${(endo * 100).toFixed(0)}%，传播已形成自激；SM→KOL 仍强于反向路径，资金链条偏上游驱动。`,
        outlook: `${priceExtended ? "趋势延续概率仍高于普通项目，但行情已进入传播中段，最早期赔率下降。" : "级联已启动但价格尚未充分扩张，后续重点看 KOL 接力和成交扩张能否继续把身份资金传播到更广泛市场。"}`,
        confirm: "ρ 维持亚临界高位、内生率继续抬升且 SM→KOL 不弱化，是延续级联的主要确认。",
        invalidation: "ρ 与内生率同步下降、SM→KOL 转弱并伴随成交量衰减，说明传播链正在失去自我维持能力。",
      };
    }
    if (kolLead) {
      return {
        bias: "中性偏谨慎 · KOL主导",
        tone: "warn",
        structure: `虽然 ρ(A)=${rho.toFixed(2)} 已显示级联，但 KOL→SM=${h.kolToSmart.toFixed(2)} 高于 SM→KOL=${h.smartToKol.toFixed(2)}，传播更像市场/KOL 热度领先、聪明钱随后参与。`,
        outlook: "这类结构仍可能上涨，但早期信息优势弱于 Smart Money 上游点火，更接近已被市场发现后的扩散。若价格同时快速上涨，应降低追高权重。",
        confirm: "若后续 SM→KOL 反超 KOL→SM，说明聪明钱重新取得传播上游位置，结构才会明显改善。",
        invalidation: "若 KOL 自激继续升高而 SM 跟随减弱，同时价格加速，容易演化成情绪主导的后段行情。",
      };
    }
    return {
      bias: "中性偏多 · 双向自激",
      tone: "neutral",
      structure: `ρ(A)=${rho.toFixed(2)}、内生率 ${(endo * 100).toFixed(0)}%，SM 与 KOL 之间没有明显单向领先，属于双向互相强化。`,
      outlook: "行情已有持续性基础，但缺少明确上游信息源，因此更像趋势确认而不是最早期 Alpha。需要结合价格是否已经充分拉升判断赔率。",
      confirm: "若 SM→KOL 开始持续高于反向路径，同时 ρ 继续上升但保持低于临界区，结构会进一步转强。",
      invalidation: "双向激发同时下降、内生率回落，意味着传播网络开始解耦，趋势延续概率下降。",
    };
  }

  return {
    bias: "中性 · 弱传播",
    tone: "neutral",
    structure: `ρ(A)=${rho.toFixed(2)}、内生率 ${(endo * 100).toFixed(0)}%，身份资金仍以外生、离散到达为主。本地证据权重 ${(evidence * 100).toFixed(0)}%。`,
    outlook: `已有身份资金活动，但尚未形成稳定自激。未来60分钟条件触发预期约 ${forecast.toFixed(2)} 个事件；后市更依赖新的独立身份资金是否连续出现。`,
    confirm: "ρ 上升到约 0.4 以上、内生率抬升，并出现明确 SM→KOL 或持续 SM→SM 自激，才说明资金结构真正变化。",
    invalidation: "若后续仍只有零散事件、ρ 长期低位，则本轮身份资金更可能是孤立交易，而非可传播 Alpha。",
  };
}

export default function HawkesPanel({ project }: { project: AlphaProject }) {
  const h = project.hawkes;
  if (!h) return <section><div className="section-title"><h3>Hawkes 传播结构</h3><span>等待模型数据</span></div><p className="muted">该项目尚未生成 Hawkes 数据。</p></section>;
  const view = outlook(project);
  const horizonLabel = h.horizonMinutes >= 60 ? `${(h.horizonMinutes / 60).toFixed(h.horizonMinutes % 60 ? 1 : 0)}H` : `${h.horizonMinutes}m`;

  return <section className={styles.section}>
    <div className="section-title"><h3>Hawkes 传播结构 v2</h3><span>Adaptive Bayesian · {horizonLabel}窗口 · {h.kernelHalfLifeMinutes.toFixed(0)}m核半衰期</span></div>
    <div className={styles.statusRow}>
      <span className={`${styles.regime} ${styles[view.tone]}`}>{regimeLabels[h.regime]}</span>
      <span>后市倾向：<b>{view.bias}</b></span>
      <span>置信度：<b>{confidenceLabels[h.confidence]}</b></span>
      <span>样本：<b>{h.eventCount}</b>（SM {h.smartEvents} / KOL {h.kolEvents}）</span>
      <span>本地证据：<b>{(h.localEvidenceWeight * 100).toFixed(0)}%</b></span>
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
      <span>未来60m条件触发 <b>{h.expectedTriggered60m.toFixed(2)}</b></span>
      <span>方向优势 <b>{h.directionalEdge >= 0 ? "+" : ""}{h.directionalEdge.toFixed(2)}</b></span>
      <span>ρ&lt;1 为亚临界；越接近 1，传播越容易自我维持</span>
    </div>

    <div className={styles.reading}>
      <div><span>当前结构</span><p>{view.structure}</p></div>
      <div className={styles.outlook}><span>行情后市判断</span><p>{view.outlook}</p></div>
      <div><span>继续走强的确认条件</span><p>{view.confirm}</p></div>
      <div><span>结构失效 / 风险信号</span><p>{view.invalidation}</p></div>
    </div>

    <p className={styles.note}>v2 读法：模型会在 2H / 6H / 24H 中自动选择最短但足够的观察窗，并在多个核半衰期中选择拟合更好的时间尺度。1笔事件不再被丢弃，而进入“种子态”，用贝叶斯后验给出条件触发预测；“本地证据”明确显示有多少激发结构来自项目自身父子事件对，避免把先验当成项目事实。该模块仍暂不参与 Alpha Score。</p>
  </section>;
}
