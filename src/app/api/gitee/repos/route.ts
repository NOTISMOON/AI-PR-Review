import { NextRequest, NextResponse } from "next/server";
import { resolveGiteeSession } from "@/lib/gitee/session";
import { listRepos } from "@/lib/gitee/client";
import { cachedRead } from "@/lib/cache/redis";
import {
  ensureReviewTables,
  ensureSettingTables,
  getSettingJson,
  listReviewJobs,
} from "@/lib/db/mysql";

export const runtime = "nodejs";

type RepoStatus = "off" | "enabled" | "reviewing";

interface GiteeRepoRow {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  /** 由后端根据自动审查开关 + 待处理任务计算出的真实状态 */
  status: RepoStatus;
}

/** 按当前登录用户（Gitee）返回分页仓库 + 全量聚合状态；缓存全量结果，切页命中缓存切片 */
export async function GET(req: NextRequest) {
  const r = await resolveGiteeSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize")) || 6, 1), 50);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  try {
    await Promise.all([ensureSettingTables(), ensureReviewTables()]);
    const all = await cachedRead<GiteeRepoRow[]>(
      `gitee:repos:${r.ctx.dbUser.id}`,
      60,
      async () => {
        const raw = await listRepos(r.token, 100);
        // 待处理审查任务 → 审查中；auto 开关 → 已开启；否则未开启
        const [autoMap, jobs] = await Promise.all([
          getSettingJson<Record<string, boolean>>(r.ctx.dbUser.id, "repo_auto_review"),
          listReviewJobs(r.ctx.dbUser.id, "gitee", 200),
        ]);
        const pendingRepos = new Set(
          (jobs ?? []).filter((j) => j.decision === "PENDING").map((j) => j.repoFullName),
        );
        return raw.map((x): GiteeRepoRow => {
          const status: RepoStatus = pendingRepos.has(x.full_name)
            ? "reviewing"
            : autoMap?.[x.full_name]
              ? "enabled"
              : "off";
          return {
            id: x.id,
            name: x.name,
            full_name: x.full_name,
            description: x.description,
            private: x.private,
            default_branch: x.default_branch,
            html_url: x.html_url,
            language: x.language,
            stargazers_count: x.stargazers_count,
            forks_count: x.forks_count,
            status,
          };
        });
      },
    );

    // 模糊搜索：name / full_name / description 命中（在缓存全量结果上过滤，切换关键字不用重打平台 API）
    const filtered = q
      ? all.filter((x) =>
          `${x.full_name} ${x.name} ${x.description ?? ""}`.toLowerCase().includes(q),
        )
      : all;

    const total = filtered.length;
    const enabledCount = filtered.filter((x) => x.status !== "off").length;
    const reviewingCount = filtered.filter((x) => x.status === "reviewing").length;
    const repos = filtered.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({
      repos,
      total,
      page,
      pageSize,
      enabledCount,
      reviewingCount,
      login: r.ctx.user.login,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}