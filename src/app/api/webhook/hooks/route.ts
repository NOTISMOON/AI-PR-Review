import { NextRequest, NextResponse } from "next/server";
import { ensureWebhookTables, getWebhookConfig } from "@/lib/db/mysql";
import { getRequestOrigin } from "@/lib/request";
import { ensureRepoHook, resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 一键配置：为指定仓库在平台侧创建 Webhook（自动回填 URL / Secret / 订阅事件） */
export async function POST(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  let body: { owner?: unknown; repo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const owner = typeof body.owner === "string" ? body.owner.trim() : "";
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  if (!owner || !repo) return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    await ensureWebhookTables();
    const cfg = await getWebhookConfig(r.ctx.dbUser.id, r.provider);
    if (!cfg?.secret) {
      return NextResponse.json(
        { error: "尚未生成 Secret，请先在页面上保存一次事件订阅/规则配置" },
        { status: 400 },
      );
    }

    const origin = getRequestOrigin(req);
    const url = `${origin}/api/webhook/${r.provider}`;
    const events = cfg.events.length ? cfg.events : ["pull_request", "push"];

    const result = await ensureRepoHook(r.provider, r.token, {
      owner,
      repo,
      url,
      secret: cfg.secret,
      events,
    });
    return NextResponse.json({ ok: true, created: result.created, id: result.id });
  } catch (e) {
    const err = e as Error & { status?: number };
    const status = err.status === 404 ? 404 : err.status === 403 ? 403 : 502;
    return NextResponse.json({ error: err.message }, { status });
  }
}
