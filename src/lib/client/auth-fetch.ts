/**
 * 客户端带鉴权的 fetch：401 时自动调用 /api/auth/refresh（基于 cookie 的 refresh_token + Redis）
 * 换新 access 并重试一次。解决 access_token 到期（15min）后接口 401 的问题。
 */
let refreshing: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  retried = false,
): Promise<Response> {
  const res = await fetch(input, { ...init, credentials: "same-origin" });
  if (res.status === 401 && !retried) {
    const ok = await tryRefresh();
    if (ok) {
      return authFetch(input, init, true);
    }
  }
  return res;
}