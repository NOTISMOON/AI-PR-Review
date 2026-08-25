/**
 * 认证配置：双 token（JWT access + refresh）
 * - access_token：短期 JWT，存 httpOnly cookie
 * - refresh_token：随机串，存 httpOnly cookie，且服务端在 Redis 存一份用于校验刷新
 */
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