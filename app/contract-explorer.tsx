"use client";

import { useState, type FormEvent } from "react";
import type { AlphaProject, Chain } from "@/lib/types";
import styles from "./contract-explorer.module.css";

type ExplorerDetail = {
  explorerProject?: AlphaProject;
  gate?: {
    eligible?: boolean;
    marketCapEligible?: boolean;
    identityEligible?: boolean;
    note?: string;
  };
  error?: string;
};

export default function ContractExplorer({ onAnalyzed }: { onAnalyzed: (project: AlphaProject, detail: ExplorerDetail) => void }) {
  const [chain, setChain] = useState<Chain>("sol");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ eligible: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ca = address.trim();
    if (!ca) {
      setError("请输入合约地址");
      return;
    }

    setLoading(true);
    setError("");
    setStatus(null);
    try {
      const response = await fetch(`/api/token?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(ca)}`, { cache: "no-store" });
      const detail: ExplorerDetail = await response.json();
      if (!response.ok) throw new Error(detail.error || "合约分析失败");
      if (!detail.explorerProject) throw new Error("未生成项目分析对象");

      onAnalyzed(detail.explorerProject, detail);
      setStatus({
        eligible: Boolean(detail.gate?.eligible),
        text: detail.gate?.eligible
          ? "Gate PASS · 当前满足榜单硬门槛"
          : "主动分析 · 当前未通过榜单硬门槛",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return <div className={styles.wrap}>
    <form className={styles.browser} onSubmit={submit}>
      <select className={styles.chain} value={chain} onChange={e => setChain(e.target.value as Chain)} aria-label="选择链">
        <option value="sol">SOL</option>
        <option value="bsc">BSC</option>
        <option value="robinhood">ROBINHOOD</option>
      </select>
      <input
        className={styles.input}
        value={address}
        onChange={e => setAddress(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder="输入合约地址 / Contract Address，直接分析任意项目…"
        aria-label="合约地址"
      />
      <button className={styles.button} disabled={loading} type="submit">{loading ? "分析中" : "分析"}</button>
    </form>
    <div className={styles.meta}>
      <span className={styles.hint}>Contract Explorer：主动查询不等于系统上榜；即使未通过 $1M + Smart/KOL Gate，也会继续分析 K线、Top Traders、P0/P0+、Hawkes、风险与梗文化。</span>
      {error ? <span className={`${styles.status} ${styles.error}`}>{error}</span> : status ? <span className={`${styles.status} ${status.eligible ? styles.pass : styles.fail}`}>{status.text}</span> : null}
    </div>
  </div>;
}
