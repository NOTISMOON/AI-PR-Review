import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/github/session";
import { listInstallations } from "@/lib/github/user-client";
import { upsertInstallation } from "@/lib/db/mysql";

export const runtime = "nodejs";

/** 同步当前用户可访问的 GitHub App 安装信息到 github_installation 表 */
export async function POST(req: NextRequest) {
  const r = await resolveSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    const installations = await listInstallations(r.token);
    let upserted = 0;
    for (const inst of installations) {
      await upsertInstallation({
        userId: r.ctx.dbUser.id,
        installationId: String(inst.id),
        accountLogin: inst.account.login,
        accountType: inst.account.type,
        appId: String(inst.app_id),
        permissions: JSON.stringify(inst.permissions),
        repositorySelection: inst.repository_selection,
      });
      upserted++;
    }
    return NextResponse.json({ ok: true, count: upserted });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}