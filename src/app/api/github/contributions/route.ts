import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/github/session";
import { buildContributions } from "@/lib/platform/contributions";
import { cachedRead } from "@/lib/cache/redis";

export const runtime = "nodejs";

const CACHE_TTL = 1800; // commit 相对稳定：缓存 30 分钟

/** GitHub 提交贡献热力图数据（按 commit 按天聚合，Redis 缓存） */
export async function GET(req: NextRequest) {
  const r = await resolveSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const y = Number(searchParams.get("year"));
    const year = Number.isInteger(y) && y >= 2000 && y <= new Date().getFullYear() ? y : undefined;
    const data = await cachedRead(`github:contributions:${r.ctx.dbUser.id}:${year ?? "near"}`, CACHE_TTL, () =>
      buildContributions("github", r.token!, r.ctx.user.login, {
        userId: r.ctx.dbUser.id,
        ...(year ? { year } : {}),
      }),
    );
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}