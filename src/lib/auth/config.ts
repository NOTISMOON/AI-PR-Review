/** 认证配置：双 token（JWT access + refresh） */
import type { NextRequest } from "next/server";

/**
 * 判断当前请求是否视为 HTTPS（决定 cookie 是否加 Secure）。
 * 生产经由反代转发时看 X-Forwarded-Proto；否则看请求 URL 本身。
 * 兼容内网穿透走 http（如 frp 暴露的 http:// 地址）时不应给 cookie 加 Secure，
 * 否则浏览器会拒绝保存凭证，导致「登录不上」。
 */
export function requestUsesHttps(req: NextRequest): boolean {
  const fwd = req.headers.get("x-forwarded-proto");
  if (fwd) return fwd.split(",")[0].trim() === "https";
  return req.url.startsWith("https://");
}

export const AUTH = {
  /** JWT 签名密钥（生产务必用环境变量覆盖） */
  jwtSecret: process.env.AUTH_JWT_SECRET || process.env.SECRET_KEY || "dev-jwt-secret-please-change",
  /** access_token 有效期（秒） */
  accessTtlSec: 15 * 60,
  /** refresh_token 有效期（秒） */
  refreshTtlSec: 60 * 60 * 24 * 7,
  /** access_token 里的过期缓冲：出于 HttpOnly cookie 需要提前刷新的时间（秒） */
  accessRenewBeforeSec: 10 * 60,
  cookieName: {
    access: "rf_access",
    refresh: "rf_refresh",
    state: "rf_oauth_state",
    provider: "rf_oauth_provider",
  } as const,
  /** 生产环境 cookie 加 Secure；本地 http 不加 */
  isSecure: process.env.NODE_ENV === "production",
};