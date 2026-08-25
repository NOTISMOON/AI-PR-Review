import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/index.css";

export const metadata: Metadata = {
  title: {
    default: "ReviewForge — AI PR Review 平台",
    template: "%s · ReviewForge",
  },
  description:
    "连接 GitHub / Gitee，自动审查你的 PR 变更，让 AI 成为你的代码审阅伙伴。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}