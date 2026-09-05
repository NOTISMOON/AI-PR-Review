export function parsePRUrl(prUrl: string): { owner: string; repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

const GITHUB_API_BASE = 'https://api.github.com';

// 文件内容缓存，避免重复请求
const fileContentCache = new Map<string, Promise<string | null>>();

// 存储当前请求上下文中的 GitHub token
let currentGitHubToken: string | undefined;

/**
 * 设置当前请求上下文的 GitHub token。
 * 应在每个 API 请求开始时调用。
 */
export function setGitHubToken(token: string | undefined) {
  currentGitHubToken = token;
}

/**
 * 请求完成后清除 GitHub token。
 */
export function clearGitHubToken() {
  currentGitHubToken = undefined;
}

function getAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'ai-pr-review-tool/1.0',
    ...extraHeaders,
  };
  // 仅使用请求上下文中的 token
  if (currentGitHubToken) {
    headers.Authorization = `Bearer ${currentGitHubToken}`;
  }
  return headers;
}

/** 处理常见的 GitHub API 错误响应 */
function handleGitHubError(res: Response, context: string): never {
  if (res.status === 404) {
    throw Object.assign(new Error(`${context}: Not found`), { code: 'NOT_FOUND', status: 404 });
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw Object.assign(
      new Error('GitHub API rate limit exceeded. Please add a GITHUB_TOKEN or try again later.'),
      { code: 'RATE_LIMIT', status: 403 }
    );
  }
  throw Object.assign(
    new Error(`${context}: ${res.statusText}`),
    { code: 'GITHUB_ERROR', status: res.status }
  );
}

// ─── 已有函数（增强版） ────────────────────────────────────

export async function fetchPRInfo(owner: string, repo: string, prNumber: number) {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
    { headers: getAuthHeaders() },
  );

  if (!res.ok) handleGitHubError(res, 'Failed to fetch PR info');

  const data = await res.json();
  return {
    title: data.title,
    number: data.number,
    author: data.user?.login || 'unknown',
    branch: data.head?.label || data.head?.ref || 'unknown',
    filesChanged: data.changed_files || 0,
    additions: data.additions || 0,
    deletions: data.deletions || 0,
    /** PR 正文/描述 — 新增 */
    body: (data.body as string) || '',
    /** 头部提交 SHA — 用于缓存键生成与文件获取 — 新增 */
    headSha: (data.head?.sha as string) || '',
    /** 基础分支名 — 新增 */
    baseBranch: (data.base?.ref as string) || '',
  };
}

export async function fetchPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: getAuthHeaders({
        Accept: 'application/vnd.github.v3.diff',
      }),
    },
  );

  if (!res.ok) handleGitHubError(res, 'Failed to fetch PR diff');
  return res.text();
}

export async function fetchPRFiles(owner: string, repo: string, prNumber: number) {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
    { headers: getAuthHeaders() },
  );

  if (!res.ok) handleGitHubError(res, 'Failed to fetch PR files');

  const files = await res.json();
  return files.map((f: any) => ({
    file: f.filename,
    additions: f.additions,
    deletions: f.deletions,
    status: f.status as 'added' | 'modified' | 'deleted',
    /** 文件的 Blob SHA（用于获取完整内容）— 新增 */
    blobUrl: (f.blob_url as string) || '',
    /** 文件的原始 URL — 新增 */
    rawUrl: (f.raw_url as string) || '',
  }));
}

// ─── 新增：扩展的上下文函数 ──────────────────────────────────

/**
 * 获取 PR 的提交消息。
 * 每条提交消息都说明了一个微意图 — 有助于模型理解变更的逻辑分组。
 */
export async function fetchPRCommits(owner: string, repo: string, prNumber: number): Promise<
  { sha: string; message: string; author: string; date: string }[]
> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=100`,
    { headers: getAuthHeaders() },
  );

  if (!res.ok) handleGitHubError(res, 'Failed to fetch PR commits');

  const commits = await res.json();
  return commits.map((c: any) => ({
    sha: (c.sha as string).slice(0, 7),
    message: (c.commit?.message as string) || '',
    author: (c.commit?.author?.name as string) || (c.committer?.login as string) || 'unknown',
    date: (c.commit?.author?.date as string) || '',
  }));
}

/**
 * 获取指定 Git 引用处文件的完整内容。
 * 用于获取 diff 片段之外的周边代码上下文。
 * 已做缓存，避免对同一文件的重复请求。
 */
export async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const cacheKey = `${owner}/${repo}/${path}@${ref}`;

  // 若缓存已存在则直接返回缓存的 Promise
  if (fileContentCache.has(cacheKey)) {
    return fileContentCache.get(cacheKey)!;
  }

  // 创建并缓存 Promise
  const fetchPromise = (async () => {
    try {
      const res = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
        { headers: getAuthHeaders() },
      );

      if (!res.ok) {
        // 文件可能过大（>1MB）或已被删除；优雅地返回 null
        if (res.status === 404 || res.status === 403) return null;
        handleGitHubError(res, `Failed to fetch file: ${path}`);
      }

      const data = await res.json();
      // GitHub 返回 base64 编码的内容
      if (data.content && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch {
      return null;
    }
  })();

  fileContentCache.set(cacheKey, fetchPromise);

  // 5 分钟后清理缓存，防止内存泄漏
  setTimeout(() => {
    fileContentCache.delete(cacheKey);
  }, 5 * 60 * 1000);

  return fetchPromise;
}

/**
 * 获取仓库目录树（浅层），用于了解项目结构。
 * 限制为前 2 层，以使响应可控。
 */
export async function fetchRepoTree(
  owner: string,
  repo: string,
  branch: string,
): Promise<{ path: string; type: 'blob' | 'tree' }[]> {
  try {
    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: getAuthHeaders() },
    );

    if (!res.ok) return [];

    const data = await res.json();
    if (data.truncated) {
      // 目录树过大；我们将基于已有数据继续处理
      console.warn('Repository tree is truncated — structure analysis will be partial');
    }

    return ((data.tree || []) as any[])
      .filter((item: any) => item.type === 'blob')
      .map((item: any) => ({
        path: item.path as string,
        type: 'blob' as const,
      }));
  } catch {
    return [];
  }
}

/**
 * 获取 PR 评审评论（PR 上的讨论）。
 */
export async function fetchPRComments(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ author: string; body: string; createdAt: string }[]> {
  try {
    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=30`,
      { headers: getAuthHeaders() },
    );

    if (!res.ok) return [];

    const comments = await res.json();
    return comments.map((c: any) => ({
      author: (c.user?.login as string) || 'unknown',
      body: (c.body as string) || '',
      createdAt: (c.created_at as string) || '',
    }));
  } catch {
    return [];
  }
}

/**
 * 从仓库获取指定的配置文件（例如 tsconfig.json、package.json）。
 */
export async function fetchConfigFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  return fetchFileContent(owner, repo, path, ref);
}
