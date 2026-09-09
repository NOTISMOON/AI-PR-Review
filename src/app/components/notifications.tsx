"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invalidateCache } from "@/lib/client/data-cache";
import { toast } from "sonner";

/**
 * 版本号驱动的通知链路。
 *
 * 根组件在此持有唯一的 SSE 连接：收到 `notification` 事件时只递增一个版本号，
 * 不把具体数据下发给各消费方。侧边栏 / 消息铃铛 / 消息列表通过 useNotifications()
 * 感知版本变化后各自重新拉取数据，从而避免每个组件各自持有 EventSource。
 */
interface NotificationContextValue {
  /** 版本号：SSE 每收到一条通知 +1，消费方在版本变化时重新拉取各自数据 */
  version: number;
  /** 手动递增版本号：本地变更（已读 / 删除等）后通知其它消费方刷新 */
  bump: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications 必须在 NotificationProvider 内使用");
  }
  return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);

  // 根组件持有唯一 SSE 连接：仅递增版本号作为感知信号，详情由各消费方自行拉取
  useEffect(() => {
    const es = new EventSource("/api/notifications/stream");
    es.addEventListener("notification", (e) => {
      // 收到通知说明服务端数据有更新：局部失效审查任务 / 通知缓存
      invalidateCache("/api/review/tasks");
      invalidateCache("/api/notifications");
      // 版本号 +1，通知所有消费方重新拉取
      setVersion((v) => v + 1);
      // 实时 toast 提示（消息带 type/title/link）
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          type?: string;
          title?: string;
          link?: string;
        };
        if (data.title) {
          toast(data.title, {
            description: data.type === "review_completed" ? "AI 审查已完成，等待处理" : "新通知",
            action: data.link
              ? {
                  label: "查看",
                  onClick: () => {
                    window.location.href = data.link!;
                  },
                }
              : undefined,
          });
        }
      } catch {
        /* 消息解析失败仅刷新 */
      }
    });
    // EventSource 内置断线自动重连；onerror 无需额外逻辑
    return () => es.close();
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(() => ({ version, bump }), [version, bump]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}