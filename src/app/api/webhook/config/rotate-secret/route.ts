import { NextRequest, NextResponse } from "next/server";
import { ensureWebhookTables, getWebhookConfig, upsertWebhookConfig } from "@/lib/db/mysql";
import { getRequestOrigin } from "@/lib/request";
import {
  buildWebhookConfig,
  generateWebhookSecret,
  resolveWebhookSession,
} from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 轮换 Webhook Secret：生成新密钥并返回（前端立即展示 + 提示去平台端更新） */
export async function POST(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await ensureWebhookTables();
    const existing = await getWebhookConfig(r.ctx.dbUser.id, r.provider);
    if (!existing) return NextResponse.json({ error: "config_not_found" }, { status: 404 });

    const secret = generateWebhookSecret();
    await upsertWebhookConfig({
      userId: r.ctx.dbUser.id,
      provider: r.provider,
      events: existing.events,
      rules: existing.rules,
      enabled: existing.enabled,
      url: existing.url ?? undefined,
      verifySsl: existing.verifySsl,
      secret,
    });

    const origin = getRequestOrigin(req);
    const data = await buildWebhookConfig(r.provider, r.ctx.dbUser.id, r.token, origin);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
