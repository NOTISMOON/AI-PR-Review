import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/github/session";
import { searchOpenPrs } from "@/lib/platform/search";

export const runtime = "nodejs";

/** GitHub 跨仓库搜索 open PR（按 PR 标题 / PR 号） */
export async function GET(req: NextRequest) {
  const r = await resolveSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ prs: [] });

  try {
    const prs = await searchOpenPrs("github", r.ctx.dbUser.id, r.token, q);
    return NextResponse.json({ prs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}