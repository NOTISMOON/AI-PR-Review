import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/github/session";
import { listRepoPulls } from "@/lib/github/user-client";
import { cachedRead } from "@/lib/cache/redis";

export const runtime = "nodejs";

/** 当前用户 GitHub 某仓库的 open PR 列表 */
export async function GET(req: NextRequest) {
  const r = await resolveSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  if (!owner || !repo) return NextResponse.json({ error: "owner,repo required" }, { status: 400 });

  try {
    // PR 列表加短缓存（60s），key 含用户+仓库维度；Redis 不可用时自动降级回源
    const pulls = await cachedRead(
      `github:pulls:${r.ctx.dbUser.id}:${owner}:${repo}`,
      60,
      async () => listRepoPulls(r.token, owner, repo),
    );
    return NextResponse.json({ pulls });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}