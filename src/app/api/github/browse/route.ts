import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/github/session";
import { buildBrowse } from "@/lib/platform/browse";
import { cachedRead } from "@/lib/cache/redis";

export const runtime = "nodejs";

const CACHE_TTL = 60; // 代码浏览数据短 TTL：1 分钟（避免打爆 rate limit）

/** GitHub 代码预览：分支 / 文件树（按目录懒加载）/ 文件内容 */
export async function GET(req: NextRequest) {
  const r = await resolveSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const owner = sp.get("owner");
  const repo = sp.get("repo");
  const ref = sp.get("ref") || undefined;
  const path = sp.get("path") || undefined;
  if (!owner || !repo) return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });

  const cacheKey = `github:browse:${r.ctx.dbUser.id}:${owner}:${repo}:${ref || ""}:${path || "root"}`;
  try {
    const data = await cachedRead(cacheKey, CACHE_TTL, () =>
      buildBrowse("github", r.token!, { owner, repo, ref, path }),
    );
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
