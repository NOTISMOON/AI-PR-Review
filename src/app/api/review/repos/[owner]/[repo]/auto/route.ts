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
import { cacheDel } from "@/lib/cache/redis";
import {
  ensureRepoHook,
  generateWebhookSecret,
  removeRepoHook,
  resolveWebhookSession,
} from "@/lib/platform/webhook";

/** 仓库开关在全局设置页展示，变更后失效其缓存 */
const settingsCacheKey = (provider: string, userId: number) => `settings:${provider}:${userId}`;

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

    // 2) 开启时自动配置 Webhook；关闭时销毁平台侧指向本服务的 Webhook
    let webhookConfigured = false;
    let webhookDestroyed = false;
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
    } else {
      const cfg = await getWebhookConfig(r.ctx.dbUser.id, r.provider);
      if (cfg?.secret) {
        const origin = getRequestOrigin(req);
        const url = `${origin}/api/webhook/${r.provider}`;
        webhookDestroyed = await removeRepoHook(r.provider, r.token, { owner, repo, url });
      }
    }

    // 仓库开关变化影响全局设置页展示，失效其缓存
    try {
      await cacheDel(settingsCacheKey(r.provider, r.ctx.dbUser.id));
    } catch {
      /* ignore */
    }

    return NextResponse.json({ ok: true, enabled, webhookConfigured, webhookDestroyed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
