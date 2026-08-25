import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";
import type { OAuthProvider } from "@/lib/auth/jwt";

export interface DashboardRepo {
  full_name: string;
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  html_url: string;
}

export interface DashboardPull {
  repo: string;
  number: number;
  title: string;
  user: string;
}

export interface DashboardData {
  login: string;
  repoCount: number;
  openPullCount: number;
  totalStars: number;
  recentRepos: DashboardRepo[];
  topRepos: DashboardRepo[];
  languageDistribution: { language: string; repoCount: number }[];
  openPulls: DashboardPull[];
}

/** 为避免 N+1 拉爆 rate limit，只对前 N 个仓库统计 open PR */
const MAX_REPOS_FOR_PULLS = 8;
const MAX_REPOS_RECENT = 6;
const MAX_PULLS = 10;

function toDashboardRepo(r: { full_name: string; name: string; description: string | null; language: string | null; stargazers_count: number; html_url: string }): DashboardRepo {
  return {
    full_name: r.full_name,
    name: r.name,
    description: r.description,
    language: r.language,
    stargazers_count: r.stargazers_count,
    html_url: r.html_url,
  };
}

export async function buildDashboard(
  provider: OAuthProvider,
  token: string,
  login: string,
): Promise<DashboardData> {
  const repos =
    provider === "github"
      ? await github.listRepos(token, 100)
      : await gitee.listRepos(token, 100);

  const recentRepos = repos.slice(0, MAX_REPOS_RECENT).map(toDashboardRepo);
  const topRepos = repos
    .slice()
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 5)
    .map(toDashboardRepo);

  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);

  const langMap = new Map<string, number>();
  for (const r of repos) {
    const lang = r.language || "other";
    langMap.set(lang, (langMap.get(lang) || 0) + 1);
  }
  const languageDistribution = [...langMap.entries()]
    .map(([language, repoCount]) => ({ language, repoCount }))
    .sort((a, b) => b.repoCount - a.repoCount)
    .slice(0, 6);

  const toScan = repos.slice(0, MAX_REPOS_FOR_PULLS);
  const pullsLists = await Promise.all(
    toScan.map(async (r) => {
      const [owner, name] = r.full_name.split("/");
      try {
        const pulls =
          provider === "github"
            ? await github.listRepoPulls(token, owner, name)
            : await gitee.listRepoPulls(token, owner, name);
        return { repo: r.full_name, pulls };
      } catch {
        return { repo: r.full_name, pulls: [] as Array<{ number: number; title: string; user?: { login: string } }> };
      }
    }),
  );

  const openPulls: DashboardPull[] = [];
  for (const { repo, pulls } of pullsLists) {
    for (const p of pulls) {
      openPulls.push({ repo, number: p.number, title: p.title, user: p.user?.login ?? "" });
    }
  }
  openPulls.sort((a, b) => b.number - a.number);

  return {
    login,
    repoCount: repos.length,
    openPullCount: openPulls.length,
    totalStars,
    recentRepos,
    topRepos,
    languageDistribution,
    openPulls: openPulls.slice(0, MAX_PULLS),
  };
}