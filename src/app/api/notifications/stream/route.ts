import { NextRequest } from "next/server";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import { ensureNotifySubscribed, NOTIFY_CHANNEL } from "@/lib/cache/redis";

export const runtime = "nodejs";

/**
 * 通知实时推送（SSE）。
 * 认证走 cookie；订阅 Redis `notify` 频道，收到消息时按 userId 过滤后推给前端。
 * Redis 不可用时仅发心跳（前端靠兜底轮询保底）；EventSource 自带断线重连。
 */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return new Response("unauthorized", { status: 401 });
  const userId = r.ctx.dbUser.id;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* 连接已关闭 */
        }
      };

      // 心跳：防止代理/浏览器超时断开长连接
      const heartbeat = setInterval(() => send(": ping\n\n"), 25000);

      // 收到 Redis 广播：仅推给属于当前用户的通知，触发前端刷新
      const onMessage = (_ch: string, message: string) => {
        try {
          const data = JSON.parse(message) as { userId?: number };
          if (data.userId !== undefined && data.userId !== userId) return;
          send(`event: notification\ndata: ${message}\n\n`);
        } catch {
          /* 消息解析失败忽略 */
        }
      };

      const sub = await ensureNotifySubscribed();
      if (sub) sub.on("message", onMessage);

      // 客户端断开/请求中止时清理（保留全局订阅连接，仅移除本连接监听）
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        if (sub) sub.removeListener("message", onMessage);
        try {
          controller.close();
        } catch {
          /* 忽略 */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
