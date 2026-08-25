import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/github/session";
import { listRepos } from "@/lib/github/user-client";
import type { GitHubRepo } from "@/lib/github/user-client";

export const runtime = "nodejs";

/** 当前登录用户（GitHub）可访问的仓库列表 */
export async function GET(req: NextRequest) {
  const r = await resolveSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    const repos = await listRepos(r.token, 100);
    const mapped: GitHubRepo[] = repos.map((x) => ({
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
    }));
    return NextResponse.json({ repos: mapped, login: r.ctx.user.login });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}