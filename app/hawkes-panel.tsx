"use client";

import type { AlphaProject, HawkesMetrics } from "@/lib/types";
import styles from "./hawkes.module.css";

const regimeLabels: Record<HawkesMetrics["regime"], string> = {
  insufficient: "暂无资金事件",
  seed: "刚有资金介入",
  unilateral: "单边持续买入",
  dormant: "暂未形成接力",
  upstream_ignition: "聪明钱带动扩散",
  cascade: "资金接力形成",
  overheated: "资金传播过热",
};

const confidenceLabels: Record<HawkesMetrics["confidence"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function relayLevel(value: number) {
  if (value < 0.2) return "低";
  if (value < 0.5) return "一般";
  if (value < 1) return "较强";
  return "很强";
}

function outlook(project: AlphaProject) {
  const h = project.hawkes;
  if (!h || h.eventCount === 0) {
    return {
      bias: "暂不判断",
      tone: "neutral",
      structure: "最近还没有捕捉到聪明钱或 KOL 的有效买入。",
      outlook: "目前看不到资金接力，先参考价格、成交、P0/P0+ 和风险模块。",
      confirm: "出现第一笔聪明钱或 KOL 买入后，这个模块才开始有参考价值。",
      invalidation: "当前没有资金传播信号。",
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
      bias: smartSeed ? "观察偏多" : "中性观察",
      tone: smartSeed ? "bull" : "warn",
      structure: smartSeed
        ? "刚出现第一笔聪明钱买入，说明有高质量资金开始关注，但目前还没有形成连续买入或 KOL 接力。"
        : "刚出现第一笔 KOL 买入，说明叙事热度开始出现，但暂时没有聪明钱跟进。",
      outlook: smartSeed
        ? "这是很早的观察信号，不等于马上会上涨。现在最重要的是看接下来有没有新的聪明钱继续买，或者 KOL 开始跟进。"
        : "单个 KOL 买入的参考价值有限。后面如果聪明钱开始跟进，信号才会明显变强；否则更可能只是一次孤立的情绪事件。",
      confirm: smartSeed
        ? "未来 1 小时再出现新的聪明钱买入，或首次出现 KOL 跟进，同时成交和流动性没有恶化，信号明显增强。"
        : "后续出现聪明钱买入，是 KOL 信号真正升级的关键确认。",
      invalidation: "如果后面一直没有新的身份资金跟进，这次买入的参考价值会快速下降。",
    };
  }

  if (h.regime === "unilateral") {
    const smartOnly = h.smartEvents > 0 && h.kolEvents === 0;
    return {
      bias: smartOnly ? "偏多观察" : "中性偏谨慎",
      tone: smartOnly ? "bull" : "warn",
      structure: smartOnly
        ? `已经连续出现 ${h.eventCount} 笔聪明钱买入，但暂时还没有 KOL 跟进。`
        : `已经连续出现 ${h.eventCount} 笔 KOL 买入，但暂时还没有聪明钱确认。`,
      outlook: smartOnly
        ? "连续聪明钱买入比单笔更有价值，说明资金正在形成一致行动。下一步如果 KOL 开始接力，通常代表项目从“资金关注”进入“传播扩散”。"
        : "KOL 连续买入说明热度在扩散，但没有聪明钱确认时，更容易是情绪驱动。若价格已经明显拉升，追高价值较低。",
      confirm: smartOnly
        ? "出现第一批 KOL 跟进，同时聪明钱仍继续买，是信号进一步变强的关键。"
        : "出现聪明钱跟进，才说明这轮热度可能不只是 KOL 自嗨。",
      invalidation: "如果同一类资金停止买入，且没有另一类资金接力，当前信号会逐步失效。",
    };
  }

  if (h.regime === "overheated") {
    return {
      bias: "高波动 · 谨慎追涨",
      tone: "risk",
      structure: "聪明钱和 KOL 的买入已经高度互相带动，资金传播非常拥挤，市场进入高热状态。",
      outlook: `${priceExtended ? "价格也已经快速拉升，说明资金和价格同时过热，继续追高的回撤风险明显增加。" : "价格还没完全垂直拉升，但资金传播已经很热，后续波动通常会明显放大。"}`,
      confirm: "更健康的情况是资金热度稍微降下来，但价格、成交和流动性仍能维持强势。",
      invalidation: "如果身份资金突然停止买入，同时价格跌回启动区，通常意味着这轮资金接力开始结束。",
    };
  }

  if (h.regime === "upstream_ignition") {
    return {
      bias: priceExtended ? "偏多 · 但已开始兑现" : "偏多 · 早期扩散",
      tone: "bull",
      structure: "当前更像聪明钱先买，随后 KOL 开始跟进，资金传播方向比较健康。",
      outlook: `${priceExtended ? "资金结构仍然偏强，但价格已经开始反应，最早期的赔率已经下降。" : "这是比较理想的早期 Alpha 结构：聪明钱先动作，KOL 再接力，而价格还没有完全兑现。"}${weakLiquidity ? " 但当前流动性偏薄，仍要防止少量资金把价格机械推高。" : ""}`,
      confirm: "聪明钱继续买、KOL 跟进数量增加、成交同步放大，但价格还没有垂直暴涨，是最理想的继续走强确认。",
      invalidation: "如果聪明钱停止买入，反而只剩 KOL 热度继续升高，早期 Alpha 质量会明显下降。",
    };
  }

  if (h.regime === "cascade") {
    if (smLead) {
      return {
        bias: priceExtended ? "偏多 · 已到传播中段" : "偏多 · 接力扩散",
        tone: "bull",
        structure: "聪明钱和 KOL 已经形成持续接力，而且目前仍然是聪明钱更偏上游。",
        outlook: priceExtended
          ? "资金接力仍然支持趋势，但行情已经不是最早期阶段，继续追高要更看重价格位置和流动性。"
          : "资金接力已经形成，但价格还没有完全反映，后面仍有继续扩散的空间。",
        confirm: "聪明钱继续保持领先、KOL 持续跟进、成交和流动性继续扩张，是趋势延续的主要确认。",
        invalidation: "如果聪明钱和 KOL 的买入同时减弱，成交也开始萎缩，说明接力正在结束。",
      };
    }
    if (kolLead) {
      return {
        bias: "中性偏谨慎 · KOL主导",
        tone: "warn",
        structure: "虽然已经形成资金接力，但目前更像 KOL 热度先起来，聪明钱随后才参与。",
        outlook: "这种结构仍可能上涨，但更像市场已经发现项目后的扩散，不属于最理想的早期 Alpha。价格如果已经快速上涨，追高要谨慎。",
        confirm: "如果后面重新变成聪明钱先买、KOL 再跟，结构才会明显改善。",
        invalidation: "如果 KOL 继续升温但聪明钱开始减少，容易逐渐演变成纯情绪行情。",
      };
    }
    return {
      bias: "中性偏多",
      tone: "neutral",
      structure: "聪明钱和 KOL 正在互相带动，但暂时看不出谁明显领先。",
      outlook: "行情有一定持续性，但更像趋势确认，不是最早期的发现阶段。此时要结合价格是否已经涨太多来判断是否还有赔率。",
      confirm: "如果聪明钱开始明显领先，同时资金接力继续增强，结构会进一步转强。",
      invalidation: "如果两边买入都同时变弱，说明资金传播开始降温。",
    };
  }

  return {
    bias: "中性 · 先观察",
    tone: "neutral",
    structure: "已经有身份资金活动，但目前这些买入还比较零散，没有形成明显接力。",
    outlook: "现在不适合仅凭几笔聪明钱或 KOL 买入追涨。后面如果新的独立资金持续出现，信号才会升级。",
    confirm: "聪明钱连续买入、KOL 开始跟进，或者两边同时增强，都是资金结构转强的信号。",
    invalidation: "如果后续一直没有新的资金跟进，这轮信号更可能只是孤立交易。",
  };
}

export default function HawkesPanel({ project }: { project: AlphaProject }) {
  const h = project.hawkes;
  if (!h) return <section><div className="section-title"><h3>Hawkes 资金传播</h3><span>等待模型数据</span></div><p className="muted">该项目尚未生成资金传播数据。</p></section>;
  const view = outlook(project);
  const horizonLabel = h.horizonMinutes >= 60 ? `${(h.horizonMinutes / 60).toFixed(h.horizonMinutes % 60 ? 1 : 0)}H` : `${h.horizonMinutes}m`;
  const relay = relayLevel(h.expectedTriggered60m);

  return <section className={styles.section}>
    <div className="section-title"><h3>Hawkes 资金传播</h3><span>观察窗口 {horizonLabel} · 模型自动适配</span></div>
    <div className={styles.statusRow}>
      <span className={`${styles.regime} ${styles[view.tone]}`}>{regimeLabels[h.regime]}</span>
      <span>当前判断：<b>{view.bias}</b></span>
      <span>可靠度：<b>{confidenceLabels[h.confidence]}</b></span>
      <span>买入样本：<b>{h.eventCount}</b>（SM {h.smartEvents} / KOL {h.kolEvents}）</span>
      <span>项目自身数据占比：<b>{(h.localEvidenceWeight * 100).toFixed(0)}%</b></span>
    </div>

    <div className={styles.cards}>
      <div className={styles.card}><span>资金传播强度</span><strong>{h.reproductionNumber.toFixed(2)}</strong><small>{h.reproductionNumber < .4 ? "目前较弱" : h.reproductionNumber < .8 ? "正在增强" : h.reproductionNumber < .95 ? "已经很强" : "接近过热"}</small></div>
      <div className={styles.card}><span>资金接力占比</span><strong>{(h.endogenousRatio * 100).toFixed(0)}%</strong><small>有多少买入可能由前面的资金带动</small></div>
      <div className={`${styles.card} ${styles.smart}`}><span>聪明钱 → KOL</span><strong>{h.smartToKol.toFixed(2)}</strong><small>聪明钱带动 KOL 的程度</small></div>
      <div className={`${styles.card} ${styles.kol}`}><span>KOL → 聪明钱</span><strong>{h.kolToSmart.toFixed(2)}</strong><small>KOL 热度带动聪明钱的程度</small></div>
    </div>

    <div className={styles.matrixLine}>
      <span>聪明钱连续性 <b>{h.smartToSmart.toFixed(2)}</b></span>
      <span>KOL连续性 <b>{h.kolToKol.toFixed(2)}</b></span>
      <span>未来1小时接力预期 <b>{relay} · {h.expectedTriggered60m.toFixed(2)}</b></span>
      <span>传播方向 <b>{h.directionalEdge > .15 ? "聪明钱领先" : h.directionalEdge < -.15 ? "KOL领先" : "暂不明显"}</b></span>
    </div>

    <div className={styles.reading}>
      <div><span>现在发生了什么</span><p>{view.structure}</p></div>
      <div className={styles.outlook}><span>对后市意味着什么</span><p>{view.outlook}</p></div>
      <div><span>什么情况会更强</span><p>{view.confirm}</p></div>
      <div><span>什么情况说明信号失效</span><p>{view.invalidation}</p></div>
    </div>

    <p className={styles.note}>简单读法：先看“聪明钱有没有继续买”，再看“KOL 有没有接力”。资金传播强度越高，说明这些买入越容易互相带动；但太高也可能意味着已经过热。项目自身数据占比越高，这个判断越依赖该项目真实历史，而不是模型先验。该模块暂不计入 Alpha Score。</p>
  </section>;
}
