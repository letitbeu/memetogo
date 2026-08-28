import type { CultureResearch } from "@/lib/types";

const fallback = (meta: Record<string, unknown>): CultureResearch => ({
  summary: `${String(meta.name || meta.symbol || "该项目")} 已进入资金异动观察，但当前公开元数据不足以可靠还原梗文化。`,
  origin: "待核验：需要结合项目X账号、官网首发内容、社区早期传播帖确认起源。",
  memeMechanism: "暂不做无证据推断。优先判断梗是否具备一句话可传播性、可二创性和跨社区复用性。",
  communityHooks: ["项目名称/视觉符号", "社区二创与复读密度", "KOL接力是否来自独立社群"],
  catalysts: ["聪明钱继续净买入", "KOL扩散从单点变为多点", "成交与持币人数同步扩张"],
  fragility: ["叙事证据不足", "资金先于文化扩散时容易退潮", "需警惕同源钱包制造虚假共识"],
  confidence: "低",
  evidence: [String(meta.twitter || "未发现X链接"), String(meta.website || "未发现官网")],
});

export async function researchCulture(meta: Record<string, unknown>): Promise<CultureResearch> {
  const key = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key) return fallback(meta);
  const evidence = {
    symbol: meta.symbol, name: meta.name, description: meta.description,
    launchpad: meta.launchpad, twitter: meta.twitter, website: meta.website, telegram: meta.telegram,
  };
  const prompt = `你是Meme币文化研究员。只允许依据下面JSON中的事实，不得编造互联网事件、人物背书、梗起源或社区规模。证据不足必须明确写“待核验”。输出严格JSON，不要Markdown。字段：summary, origin, memeMechanism, communityHooks(string[]), catalysts(string[]), fragility(string[]), confidence(高|中|低), evidence(string[])。重点回答：这个梗是什么、为什么可能传播、靠什么人群/符号形成共识、当前最关键的证伪点。\nDATA=${JSON.stringify(evidence)}`;
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-chat", temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return fallback(meta);
    const data = await response.json();
    const raw = String(data?.choices?.[0]?.message?.content || "{}").replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(raw);
    return {
      summary: String(parsed.summary || "待核验"), origin: String(parsed.origin || "待核验"), memeMechanism: String(parsed.memeMechanism || "待核验"),
      communityHooks: Array.isArray(parsed.communityHooks) ? parsed.communityHooks.map(String).slice(0, 6) : [],
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.map(String).slice(0, 6) : [],
      fragility: Array.isArray(parsed.fragility) ? parsed.fragility.map(String).slice(0, 6) : [],
      confidence: ["高", "中", "低"].includes(parsed.confidence) ? parsed.confidence : "低",
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 8) : [],
    };
  } catch { return fallback(meta); }
}
