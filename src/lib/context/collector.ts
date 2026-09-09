/**
 * 上下文收集器——协调从 GitHub API 和本地处理中收集所有上下文数据。
 *
 * 这是上下文流水线的中心入口。
 * 它协调抓取、提取和优先级排序。
 */

import type { PRInfo, FileChange, CommitInfo, CollectedContext, DependencyGraph, FileWithContext, RelatedFile } from '@/types/analysis';
import {
  fetchPRInfo, fetchPRDiff, fetchPRFiles,
  fetchPRCommits, fetchPRComments, fetchRepoTree, fetchConfigFile,
} from '@/lib/github';
import { extractSurroundingContext } from './sources/full-files';
import { findRelatedFiles } from './sources/related-files';
import { prioritizeFiles } from './prioritizer';
import { estimateTokens } from './token-counter';

export interface CollectionOptions {
  /** 是否抓取周边上下文的完整文件内容 */
  includeSurroundingCode: boolean;
  /** 是否构建依赖图 */
  includeDependencyGraph: boolean;
  /** 是否抓取 PR 评论 */
  includePRComments: boolean;
  /** 是否抓取语言配置文件 */
  includeLanguageConfigs: boolean;
  /** 抓取完整内容的最大文件数 */
  maxFullFiles: number;
  /** 是否使用 AI 从仓库中查找相关文件（LLM 语义检索） */
  includeRelatedFiles: boolean;
  /** 要检索的相关文件最大数量 */
  maxRelatedFiles: number;
}

const DEFAULT_OPTIONS: CollectionOptions = {
  includeSurroundingCode: true,
  includeDependencyGraph: true,
  includePRComments: false,
  includeLanguageConfigs: true,
  maxFullFiles: 30,
  includeRelatedFiles: false,
  maxRelatedFiles: 12,
};

/**
 * 收集一次 PR 分析的全面上下文。
 */
export async function collectContext(
  owner: string,
  repo: string,
  prNumber: number,
  options: Partial<CollectionOptions> = {},
): Promise<CollectedContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // ═══ 阶段 1：抓取 PR 数据和仓库结构（全部并行）═══
  const prInfoPromise = fetchPRInfo(owner, repo, prNumber);

  const [prInfo, fileChanges, diff, commits, repoStructure, prComments] = await Promise.all([
    prInfoPromise,
    fetchPRFiles(owner, repo, prNumber),
    fetchPRDiff(owner, repo, prNumber),
    fetchPRCommits(owner, repo, prNumber),
    // 使用 prInfo promise 并行抓取仓库结构
    prInfoPromise.then((info) =>
      fetchRepoTree(owner, repo, info.baseBranch).then((tree) => tree.map((item) => item.path))
    ),
    opts.includePRComments ? fetchPRComments(owner, repo, prNumber) : Promise.resolve([]),
  ]);

  // ═══ 阶段 2：语言配置 ═══
  const languageConfigs = opts.includeLanguageConfigs
    ? await fetchLanguageConfigs(owner, repo, prInfo.headSha, fileChanges)
    : {};

  // ═══ 阶段 3：文件级别上下文提取 ═══
  let filesWithContext: FileWithContext[] = [];

  if (opts.includeSurroundingCode && prInfo.headSha) {
    // 对文件进行优先级排序，以限制完整内容的抓取次数
    const priorities = prioritizeFiles(fileChanges);
    const topFiles = priorities.slice(0, opts.maxFullFiles).map((p) => p.file);

    filesWithContext = await extractSurroundingContext(
      owner, repo, prInfo.headSha, topFiles, diff,
    );
  }

  // ═══ 阶段 4：依赖图 ═══
  // 依赖图由 LangGraph 的 build_graph 节点用 AI 分析构建（按审查深度决定是否跳过），
  // 此处不再做硬编码正则构建（耗时且不通用）。
  let dependencyGraph: DependencyGraph | null = null;

  // ═══ 阶段 5：AI 驱动的相关文件检索（LLM 语义检索，非向量检索） ═══
  let relatedFiles: RelatedFile[] = [];
  if (opts.includeRelatedFiles && repoStructure.length > 0 && prInfo.headSha) {
    console.log(`[retrieve] Finding related files in ${repoStructure.length} repo files...`);
    try {
      relatedFiles = await findRelatedFiles(
        prInfo,
        fileChanges,
        commits,
        repoStructure,
        {
          maxFiles: opts.maxRelatedFiles,
          fetchContent: true,
          owner,
          repo,
          headSha: prInfo.headSha,
        },
      );
      console.log(`[retrieve] Found ${relatedFiles.length} related files.`);
    } catch (error) {
      console.warn('[retrieve] Related file retrieval failed, continuing without:', error);
      relatedFiles = []; // 优雅降级
    }
  }

  return {
    prInfo,
    fileChanges,
    commits,
    diff,
    filesWithContext,
    dependencyGraph,
    repoStructure,
    prComments,
    languageConfigs,
    relatedFiles,
  };
}

/**
 * 快速上下文收集——为快速扫描提供最少的数据。
 */
export async function collectQuickContext(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CollectedContext> {
  return collectContext(owner, repo, prNumber, {
    includeSurroundingCode: false,
    includeDependencyGraph: false,
    includePRComments: false,
    includeLanguageConfigs: false,
    includeRelatedFiles: false,
  });
}

/**
 * 标准上下文收集——兼顾速度与深度。
 */
export async function collectStandardContext(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CollectedContext> {
  return collectContext(owner, repo, prNumber, {
    includeSurroundingCode: true,
    includeDependencyGraph: true,
    includePRComments: false,
    includeLanguageConfigs: true,
    maxFullFiles: 30,
    includeRelatedFiles: true,
    maxRelatedFiles: 10,
  });
}

/**
 * 深度上下文收集——为全面审查提供最大深度。
 */
export async function collectDeepContext(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CollectedContext> {
  return collectContext(owner, repo, prNumber, {
    includeSurroundingCode: true,
    includeDependencyGraph: true,
    includePRComments: true,
    includeLanguageConfigs: true,
    maxFullFiles: 100,
    includeRelatedFiles: true,
    maxRelatedFiles: 20,
  });
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────

/**
 * 抓取相关的语言专属配置文件。
 */
async function fetchLanguageConfigs(
  owner: string,
  repo: string,
  ref: string,
  fileChanges: FileChange[],
): Promise<Record<string, string>> {
  const configs: Record<string, string> = {};

  // 根据变更文件检测需要抓取哪些配置文件
  const extensions = new Set(
    fileChanges.map((f) => f.file.slice(f.file.lastIndexOf('.'))),
  );

  const configCandidates: string[] = [];

  if (extensions.has('.ts') || extensions.has('.tsx') || extensions.has('.js')) {
    configCandidates.push('tsconfig.json', 'package.json', '.eslintrc.json', '.eslintrc.js', 'eslint.config.js');
  }
  if (extensions.has('.py')) {
    configCandidates.push('pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg');
  }
  if (extensions.has('.go')) {
    configCandidates.push('go.mod', 'go.sum');
  }
  if (extensions.has('.rs')) {
    configCandidates.push('Cargo.toml', 'Cargo.lock');
  }
  if (extensions.has('.java')) {
    configCandidates.push('pom.xml', 'build.gradle', 'build.gradle.kts');
  }

  // 总是尝试获取这些配置文件
  configCandidates.push('package.json', '.gitignore');

  const uniqueConfigs = [...new Set(configCandidates)];

  const results = await Promise.all(
    uniqueConfigs.map(async (path) => {
      const content = await fetchConfigFile(owner, repo, path, ref);
      return { path, content };
    }),
  );

  for (const { path, content } of results) {
    if (content) {
      configs[path] = content;
    }
  }

  return configs;
}
