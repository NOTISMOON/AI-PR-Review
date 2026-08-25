import { NextRequest } from "next/server";

/**
 * 从请求解析可信的 origin（协议 + 主机）。
 * 内网穿透 / 反向代理常把 Host 头改写为 localhost，导致 req.url 变成本地地址，
 * 因此优先使用 X-Forwarded-Host / X-Forwarded-Proto（穿透工具与云平台通常都会设置）。
 */
export function getRequestOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const host = fwdHost || req.headers.get("host") || "localhost:3000";
  const firstHost = host.split(",")[0].trim();
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (req.url.startsWith("https://") ? "https" : "http");
  return `${proto}://${firstHost}`;
}
