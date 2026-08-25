import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";
import type { OAuthProvider } from "@/lib/auth/jwt";
import { upsertContributionDay } from "@/lib/db/mysql";

export interface ContributionsData {
  year: number;
  /** 每周一列、固定 7 行（Sun..Sat），null 表示窗口外 */
  weeks: (number | null)[][];
  /** 月份标签：col = 该月首日所在周列下标 */
  months: { label: string; col: number }[];
  total: number;
  max: number;
}

const DAY_MS = 24 * 3600 * 1000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_REPOS = 5;

function toDayKey(iso: string): string {
  return iso.slice(0, 10);
}
function addDaysUTC(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function dayCount(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** 计算展示窗口：近 12 个月（滚动）或指定自然年 */
function resolveWindow(opts?: { year?: number }) {
  const now = new Date();
  if (opts?.year) {
    const displayYear = opts.year;
    const jan1 = new Date(Date.UTC(displayYear, 0, 1));
    const start = addDaysUTC(jan1, -jan1.getUTCDay());
    const dec31 = new Date(Date.UTC(displayYear, 11, 31));
    const end = addDaysUTC(dec31, 6 - dec31.getUTCDay());
    return { displayYear, start, end };
  }
  const thisSunday = addDaysUTC(now, -now.getUTCDay());
  return {
    displayYear: now.getUTCFullYear(),
    start: addDaysUTC(thisSunday, -(52 - 1) * 7),
    end: thisSunday,
  };
}

/** 按天聚合（非 GitHub 官方来源：Gitee 用抽样） */
async function scrapeByDay(
  provider: OAuthProvider,
  token: string,
  login: string,
  startIso: string,
  endKey: string,
  repoLimit = MAX_REPOS,
  maxPages = 2,
): Promise<Map<string, number>> {
  const repos =
    provider === "github" ? await github.listRepos(token, 100) : await gitee.listRepos(token, 100);
  const byDay = new Map<string, number>();
  const startKey = toDayKey(startIso);
  const targets = repos.slice(0, repoLimit);
  /** 单仓库采集：失败仅影响该仓库，不拖垮整批（尤其 Gitee 限流时） */
  const collect = async (r: { full_name: string }) => {
    const [owner, name] = r.full_name.split("/");
    try {
      const dates =
        provider === "github"
          ? await github.listRepoCommits(token, owner, name, startIso, login, maxPages)
          : await gitee.listRepoCommits(token, owner, name, startIso, maxPages);
      for (const iso of dates) {
        const key = toDayKey(iso);
        if (key >= startKey && key < endKey) byDay.set(key, (byDay.get(key) || 0) + 1);
      }
    } catch {
      /* ignore */
    }
  };
  // 并发限流：分批执行，降低 Gitee 免费 token 每分钟上限被 429 命中的概率，减少热力图数据遗漏
  const CONCURRENCY = 4;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(collect));
  }
  return byDay;
}

export async function buildContributions(
  provider: OAuthProvider,
  token: string,
  login: string,
  opts?: { year?: number; userId?: number },
): Promise<ContributionsData> {
  const { displayYear, start, end } = resolveWindow(opts);
  const startIso = start.toISOString();
  const endKey = toDayKey(addDaysUTC(end, 1).toISOString());
  const daysCount = dayCount(start, end) + 1;

  // 来源：GitHub 用官方 GraphQL 日历（最准，与网页一致）；Gitee 用抽样
  let byDay: Map<string, number>;
  try {
    if (provider === "github") {
      let calendar: github.ContributionCalendar;
      if (opts?.year) {
        // 年份查询：from=该年1/1，to=「现在」（GitHub 对完全过去的 to 会返回空导致回退抽样）
        // 之后再按该年窗口 [start,end] 裁剪即可
        calendar = await github.fetchContributionCalendar(
          token,
          login,
          new Date(Date.UTC(opts.year, 0, 1)).toISOString(),
          new Date().toISOString(),
        );
      } else {
        calendar = await github.fetchContributionCalendar(token, login, startIso, end.toISOString());
      }
      byDay = new Map(calendar.days.filter((d) => d.count > 0).map((d) => [d.date, d.count]));
    } else {
      // Gitee 无官方贡献日历：扫更多仓库、更多页，尽量完整并按 commit 按天聚合
      byDay = await scrapeByDay(provider, token, login, startIso, endKey, 20, 3);
    }
  } catch {
    byDay = await scrapeByDay(provider, token, login, startIso, endKey, 20, 3);
  }

  const days: number[] = [];
  let total = 0;
  let max = 0;
  for (let k = 0; k < daysCount; k++) {
    const key = toDayKey(addDaysUTC(start, k).toISOString());
    const c = byDay.get(key) || 0;
    days.push(c);
    total += c;
    if (c > max) max = c;
  }

  // 落库 persistence（供热力图数据库读取）
  if (opts?.userId) {
    try {
      for (let k = 0; k < daysCount; k++) {
        if (days[k] > 0) {
          await upsertContributionDay(opts.userId, provider, toDayKey(addDaysUTC(start, k).toISOString()), days[k]);
        }
      }
    } catch {
      /* 落库失败不影响返回 */
    }
  }

  const months: { label: string; col: number }[] = [];
  const firstOfFirstMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const cursor = new Date(firstOfFirstMonth);
  while (cursor.getTime() <= end.getTime()) {
    const idx = dayCount(start, cursor);
    if (idx >= 0 && idx < daysCount) months.push({ label: MONTH_LABELS[cursor.getUTCMonth()], col: Math.floor(idx / 7) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // 平铺 days 切成周列（Sun 为每行首），与 GitHub 周结构一致
  const weeks: (number | null)[][] = [];
  for (let k = 0; k < daysCount; k += 7) {
    const week: (number | null)[] = [];
    for (let r = 0; r < 7; r++) week.push(k + r < daysCount ? days[k + r] : null);
    weeks.push(week);
  }

  return { year: displayYear, weeks, months, total, max };
}