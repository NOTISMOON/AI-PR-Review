import { NextRequest, NextResponse } from "next/server";
import { handleWebhookDelivery } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** Gitee Webhook 接收端点：验签（X-Gitee-Token）+ 幂等 + 写日志 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const result = await handleWebhookDelivery("gitee", raw, req.headers);
  return NextResponse.json(result.body, { status: result.status });
}
