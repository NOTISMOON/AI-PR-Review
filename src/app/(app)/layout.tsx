import type { ReactNode } from "react";
import AppShell from "./app-shell";
import { PlatformProvider } from "@/app/components/platform";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformProvider>
      <AppShell>{children}</AppShell>
    </PlatformProvider>
  );
}