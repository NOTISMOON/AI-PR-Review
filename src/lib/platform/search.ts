import { cachedRead } from "@/lib/cache/redis";
import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";
import type { OAuthProvider } from "@/lib/auth/jwt";

export interface SearchPrResult {
  number: number;
  title: string;
  html_url: string;
  repo: string;
  /** open | closed | merged（GitHub 无独立 merged 值，合并的 PR 记为 closed） */
  state?: string;
}

/**
 * 跨仓库搜索 PR：按「PR 标题包含关键词」或「PR 号精确匹配」，不限状态（含已合并/已关闭）。
 * 与仓库名/描述无关，直接遍历该用户的全部仓库拉 PR 过滤，避免「先匹配仓库再挖 PR」搜不到 PR 标题的问题。
 * repos / pulls 均复用既有短缓存，并发受限，降低平台 rate limit 命中概率。
 */
export async function searchOpenPrs(
  provider: OAuthProvider,
  userId: number,
  token: string,
  q: string,
  maxRepos = 30,
): Promise<SearchPrResult[]> {
  const kw = q.trim();
  if (!kw) return [];
  const client = provider === "github" ? github : gitee;

  let repos: any[] = [];
  try {
    repos = await cachedRead(`${provider}:repos:${userId}`, 60, () =>
      client.listRepos(token, 100),
    );
  } catch {
    /* 仓库列表拉取失败返回空 */
    return [];
  }

  const num = Number(kw);
  const out: SearchPrResult[] = [];
  const tops = (Array.isArray(repos) ? repos : []).slice(0, maxRepos);
  const CONCURRENCY = 6;
  for (let i = 0; i < tops.length; i += CONCURRENCY) {
    await Promise.all(
      tops.slice(i, i + CONCURRENCY).map(async (repo: any) => {
        const [owner, name] = String(repo?.full_name || "").split("/");
        if (!owner || !name) return;
        try {
          const pulls = await cachedRead(
            `${provider}:pulls-all:${userId}:${owner}:${name}`,
            60,
            () => client.listRepoPulls(token, owner, name, "all"),
          );
          (Array.isArray(pulls) ? pulls : []).forEach((p: any) => {
            const hitTitle = (p?.title || "").toLowerCase().includes(kw.toLowerCase());
            const hitNumber = Number.isInteger(num) && Number(p?.number) === num;
            if (hitTitle || hitNumber) {
              out.push({
                number: p.number,
                title: p.title,
                html_url: p.html_url,
                repo: repo.full_name,
                state: p?.state ?? "open",
              });
            }
          });
        } catch {
          /* 单个仓库 PR 拉取失败不影响其它 */
        }
      }),
    );
  }
  // open 优先，其次（已合并/已关闭）靠后
  const order = { open: 0, merged: 1, closed: 2 };
  return out
    .sort((a, b) => (order[a.state as keyof typeof order] ?? 3) - (order[b.state as keyof typeof order] ?? 3))
    .slice(0, 20);
}