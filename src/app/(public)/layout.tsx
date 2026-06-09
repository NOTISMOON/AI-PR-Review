import type { Metadata } from "next";
import type { ReactNode } from "react";
import AnalysisTasksWatcher from "@/app/components/AnalysisTasksWatcher";
import "../../styles/index.css";

export const metadata: Metadata = {
  title: "AI Code Review Tool",
  description: "Analyze GitHub pull requests with AI-assisted review insights.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <AnalysisTasksWatcher />
      </body>
    </html>
  );
}
