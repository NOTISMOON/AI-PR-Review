import { SignJWT, jwtVerify } from "jose";
import { AUTH } from "./config";

export type OAuthProvider = "github" | "gitee";

/** 访问令牌携带的最小用户身份（单登录身份模型：provider + provider_user_id = 一个用户） */
export interface AuthUser {
  sub: string; // `${provider}:${provider_user_id}`
  provider: OAuthProvider;
  providerUserId: string;
  login: string;
  name: string;
  avatar: string;
}

const secret = () => new TextEncoder().encode(AUTH.jwtSecret);

/** 签发 access_token（短期 JWT） */
export async function signAccessToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    provider: user.provider,
    providerUserId: user.providerUserId,
    login: user.login,
    name: user.name,
    avatar: user.avatar,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${AUTH.accessTtlSec}s`)
    .sign(secret());
}

/** 校验 access_token，失败返回 null */
export async function verifyAccessToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as AuthUser;
  } catch {
    return null;
  }
}