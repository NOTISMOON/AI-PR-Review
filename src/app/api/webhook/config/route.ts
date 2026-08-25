import { NextRequest, NextResponse } from "next/server";
import { ensureWebhookTables, getWebhookConfig, upsertWebhookConfig } from "@/lib/db/mysql";
import { getRequestOrigin } from "@/lib/request";
import {
  buildWebhookConfig,
  generateWebhookSecret,
  resolveWebhookSession,
} from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 读取 / 保存当前登录平台的 Webhook 端点配置 */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await ensureWebhookTables();
    const origin = getRequestOrigin(req);
    const data = await buildWebhookConfig(r.provider, r.ctx.dbUser.id, r.token, origin);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** 保存事件订阅 / 通知规则 / 启用状态；首次配置时自动生成 Secret */
export async function POST(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  let body: { events?: unknown; rules?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const events = Array.isArray(body.events)
    ? body.events.filter((x): x is string => typeof x === "string").slice(0, 20)
    : [];
  const rules: Record<string, boolean> = {};
  if (body.rules && typeof body.rules === "object") {
    for (const [k, v] of Object.entries(body.rules as Record<string, unknown>)) {
      if (typeof v === "boolean") rules[k] = v;
    }
  }
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

  try {
    await ensureWebhookTables();
    // 首次配置（尚无 secret）时生成并返回给前端展示
    const existing = await getWebhookConfig(r.ctx.dbUser.id, r.provider);
    const newSecret = existing?.secret ? undefined : generateWebhookSecret();
    const origin = getRequestOrigin(req);

    await upsertWebhookConfig({
      userId: r.ctx.dbUser.id,
      provider: r.provider,
      events,
      rules,
      enabled,
      url: `${origin}/api/webhook/${r.provider}`,
      secret: newSecret,
    });

    const data = await buildWebhookConfig(r.provider, r.ctx.dbUser.id, r.token, origin);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
