import type { Metadata } from "next";
import type { ReactNode } from "react";
import DetailRequestStabilizer from "./detail-request-stabilizer";
import "./globals.css";

export const metadata: Metadata = {
  title: "MemeToGo Alpha Radar",
  description: "Smart Money / KOL first meme alpha discovery dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="zh-CN"><body><DetailRequestStabilizer />{children}</body></html>;
}
