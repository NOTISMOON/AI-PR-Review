import { NextRequest, NextResponse } from "next/server";
import { resolveGiteeSession } from "@/lib/gitee/session";
import { listRepoPulls } from "@/lib/gitee/client";

export const runtime = "nodejs";

/** 当前用户 Gitee 某仓库的 open PR 列表 */
export async function GET(req: NextRequest) {
  const r = await resolveGiteeSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  if (!owner || !repo) return NextResponse.json({ error: "owner,repo required" }, { status: 400 });

  try {
    const pulls = await listRepoPulls(r.token, owner, repo);
    return NextResponse.json({ pulls });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}