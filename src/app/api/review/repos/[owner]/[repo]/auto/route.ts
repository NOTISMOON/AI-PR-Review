import { NextRequest, NextResponse } from "next/server";
import {
  ensureSettingTables,
  ensureWebhookTables,
  getSettingJson,
  getWebhookConfig,
  setSetting,
  upsertWebhookConfig,
} from "@/lib/db/mysql";
import { getRequestOrigin } from "@/lib/request";
import { ensureRepoHook, generateWebhookSecret, resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/**
 * 仓库自动审查开关：开启时自动为该仓库配置 Webhook（复用一键配置逻辑），
 * 关闭时仅更新开关状态（不删除平台侧 hook）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (r.provider !== "github") {
    return NextResponse.json({ error: "自动审查目前仅支持 GitHub" }, { status: 400 });
  }
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const { owner, repo } = await params;
  if (!owner || !repo) return NextResponse.json({ error: "missing owner/repo" }, { status: 400 });

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const enabled = body.enabled === true;

  try {
    await Promise.all([ensureSettingTables(), ensureWebhookTables()]);
    const fullName = `${owner}/${repo}`;

    // 1) 更新开关状态（KV）
    const repoAuto = (await getSettingJson<Record<string, boolean>>(r.ctx.dbUser.id, "repo_auto_review")) ?? {};
    if (enabled) repoAuto[fullName] = true;
    else delete repoAuto[fullName];
    await setSetting(r.ctx.dbUser.id, "repo_auto_review", JSON.stringify(repoAuto));

    // 2) 开启时自动配置 Webhook（无 Secret 则先生成）
    let webhookConfigured = false;
    if (enabled) {
      let cfg = await getWebhookConfig(r.ctx.dbUser.id, r.provider);
      const secret = cfg?.secret ?? generateWebhookSecret();
      if (!cfg?.secret) {
        await upsertWebhookConfig({
          userId: r.ctx.dbUser.id,
          provider: r.provider,
          events: cfg?.events ?? ["pull_request", "push"],
          rules: cfg?.rules ?? {},
          enabled: true,
          secret,
        });
        cfg = await getWebhookConfig(r.ctx.dbUser.id, r.provider);
      }
      if (cfg?.secret) {
        const origin = getRequestOrigin(req);
        const url = `${origin}/api/webhook/${r.provider}`;
        const events = cfg.events.length ? cfg.events : ["pull_request", "push"];
        await ensureRepoHook(r.provider, r.token, { owner, repo, url, secret: cfg.secret, events });
        webhookConfigured = true;
      }
    }

    return NextResponse.json({ ok: true, enabled, webhookConfigured });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
