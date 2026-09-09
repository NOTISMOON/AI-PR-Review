import type { ReactNode } from "react";
import AppShell from "./app-shell";
import { PlatformProvider } from "@/app/components/platform";
import { NotificationProvider } from "@/app/components/notifications";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformProvider>
      <NotificationProvider>
        <AppShell>{children}</AppShell>
      </NotificationProvider>
    </PlatformProvider>
  );
}