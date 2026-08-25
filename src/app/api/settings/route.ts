import { NextRequest, NextResponse } from "next/server";
import {
  ensureSettingTables,
  ensureWebhookTables,
  getSettingJson,
  getWebhookConfig,
  setSetting,
} from "@/lib/db/mysql";
import { getAvailableModels } from "@/lib/models/registry";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";

export const runtime = "nodejs";

interface AiSettings {
  model: string;
  temperature: number;
  maxComments: string;
  riskThreshold: string;
}

interface SwitchSettings {
  auto_write: boolean;
  set_status: boolean;
  diff_only: boolean;
  skip_draft: boolean;
}

const DEFAULT_AI: AiSettings = { model: "", temperature: 0.2, maxComments: "20", riskThreshold: "默认" };
const DEFAULT_SWITCHES: SwitchSettings = {
  auto_write: true,
  set_status: true,
  diff_only: true,
  skip_draft: false,
};

/** 读取当前登录平台的全局设置（AI 参数 + 审查规则 + webhook 事件/通知规则 + 仓库开关） */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await Promise.all([ensureSettingTables(), ensureWebhookTables()]);
    const [ai, switches, repoAuto] = await Promise.all([
      getSettingJson<AiSettings>(r.ctx.dbUser.id, "ai"),
      getSettingJson<SwitchSettings>(r.ctx.dbUser.id, "switches"),
      getSettingJson<Record<string, boolean>>(r.ctx.dbUser.id, "repo_auto_review"),
    ]);
    const cfg = await getWebhookConfig(r.ctx.dbUser.id, r.provider);

    const models = getAvailableModels().map((m) => ({ id: m.modelId, name: m.displayName }));
    const repos = await listReposWithSwitch(r, repoAuto ?? {});

    return NextResponse.json({
      ai: ai ?? DEFAULT_AI,
      switches: switches ?? DEFAULT_SWITCHES,
      webhook: { events: cfg?.events ?? null, rules: cfg?.rules ?? null },
      repoAutoReview: repoAuto ?? {},
      models,
      repos,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** 保存全局设置（AI 审查参数 + 审查规则；仓库开关/事件订阅走独立接口） */
export async function POST(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await ensureSettingTables();

    if (body.ai && typeof body.ai === "object") {
      await setSetting(r.ctx.dbUser.id, "ai", JSON.stringify(body.ai));
    }
    if (body.switches && typeof body.switches === "object") {
      await setSetting(r.ctx.dbUser.id, "switches", JSON.stringify(body.switches));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** 平台仓库列表 + autoReview 开关（复用 KV 记录） */
async function listReposWithSwitch(
  r: { provider: "github" | "gitee"; token: string | null },
  repoAuto: Record<string, boolean>,
): Promise<{ full_name: string; name: string; autoReview: boolean }[]> {
  if (!r.token) return [];
  try {
    const repos =
      r.provider === "github"
        ? await github.listRepos(r.token, 100)
        : await gitee.listRepos(r.token, 100);
    return repos.map((x) => ({
      full_name: x.full_name,
      name: x.name,
      autoReview: !!repoAuto[x.full_name],
    }));
  } catch {
    return [];
  }
}
