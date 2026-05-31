export function parsePRUrl(prUrl: string): { owner: string; repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

const GITHUB_API_BASE = 'https://api.github.com';

// File content cache to avoid duplicate fetches
const fileContentCache = new Map<string, Promise<string | null>>();

// Store the current GitHub token for this request context
let currentGitHubToken: string | undefined;

/**
 * Set the GitHub token for the current request context.
 * This should be called at the start of each API request.
 */
export function setGitHubToken(token: string | undefined) {
  currentGitHubToken = token;
}

/**
 * Clear the GitHub token after the request is complete.
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
  // Prioritize token from request context, fallback to environment variable
  const token = currentGitHubToken || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Handle common GitHub API error responses */
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

// ─── Existing functions (enhanced) ────────────────────────────────────

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
    /** PR body/description — NEW */
    body: (data.body as string) || '',
    /** Head commit SHA — for cache keying and file fetching — NEW */
    headSha: (data.head?.sha as string) || '',
    /** Base branch name — NEW */
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
    /** Blob SHA of the file (for full content fetch) — NEW */
    blobUrl: (f.blob_url as string) || '',
    /** Raw URL for the file — NEW */
    rawUrl: (f.raw_url as string) || '',
  }));
}

// ─── NEW: Extended context functions ──────────────────────────────────

/**
 * Fetch commit messages for a PR.
 * Each commit message explains a micro-intent — helps the model understand
 * the logical grouping of changes.
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
 * Fetch full file content at a specific Git ref.
 * Used to get surrounding code context beyond the diff hunks.
 * Cached to avoid duplicate requests for the same file.
 */
export async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const cacheKey = `${owner}/${repo}/${path}@${ref}`;

  // Return cached promise if exists
  if (fileContentCache.has(cacheKey)) {
    return fileContentCache.get(cacheKey)!;
  }

  // Create and cache the promise
  const fetchPromise = (async () => {
    try {
      const res = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
        { headers: getAuthHeaders() },
      );

      if (!res.ok) {
        // File might be too large (>1MB) or deleted; gracefully return null
        if (res.status === 404 || res.status === 403) return null;
        handleGitHubError(res, `Failed to fetch file: ${path}`);
      }

      const data = await res.json();
      // GitHub returns base64-encoded content
      if (data.content && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch {
      return null;
    }
  })();

  fileContentCache.set(cacheKey, fetchPromise);

  // Clean up cache after 5 minutes to prevent memory leak
  setTimeout(() => {
    fileContentCache.delete(cacheKey);
  }, 5 * 60 * 1000);

  return fetchPromise;
}

/**
 * Fetch repository tree (shallow) to understand project structure.
 * Limited to top 2 levels to keep response manageable.
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
      // Tree is too large; we'll work with what we have
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
 * Fetch PR review comments (discussion on the PR).
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
 * Fetch a specific configuration file from the repo (e.g., tsconfig.json, package.json).
 */
export async function fetchConfigFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  return fetchFileContent(owner, repo, path, ref);
}
