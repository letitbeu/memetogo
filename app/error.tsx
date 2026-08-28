"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("MemeToGo page error", error);
  }, [error]);

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#050b12", color: "#eaf4ff", padding: 24 }}>
    <div style={{ maxWidth: 620, border: "1px solid #22354a", borderRadius: 16, padding: 24, background: "#08131f" }}>
      <div style={{ fontSize: 12, letterSpacing: 2, color: "#5ddcff", marginBottom: 10 }}>MEMETOGO RECOVERY</div>
      <h2 style={{ margin: "0 0 10px" }}>页面组件出现异常，但数据服务仍可继续使用</h2>
      <p style={{ margin: "0 0 18px", color: "#91a2b5", lineHeight: 1.7 }}>通常是某个项目详情数据触发了前端渲染异常。点击下面按钮只重置当前页面组件，不会清空你的 Alpha 历史。</p>
      <button onClick={reset} style={{ border: "1px solid #2d6380", borderRadius: 10, padding: "10px 16px", background: "#0c2332", color: "#dff8ff", cursor: "pointer", fontWeight: 700 }}>恢复页面</button>
      {error?.message ? <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", color: "#6f8296", fontSize: 12 }}>{error.message}</pre> : null}
    </div>
  </main>;
}
