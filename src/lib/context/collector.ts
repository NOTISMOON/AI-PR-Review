/**
 * Context Collector — orchestrates the gathering of all context data
 * from GitHub APIs and local processing.
 *
 * This is the central entry point for the context pipeline.
 * It coordinates fetching, extraction, and prioritization.
 */

import type { PRInfo, FileChange, CommitInfo, CollectedContext, DependencyGraph, FileWithContext, RelatedFile } from '@/types/analysis';
import {
  fetchPRInfo, fetchPRDiff, fetchPRFiles,
  fetchPRCommits, fetchPRComments, fetchRepoTree, fetchConfigFile,
} from '@/lib/github';
import { extractSurroundingContext } from './sources/full-files';
import { buildDependencyGraph } from './sources/dependencies';
import { findRelatedFiles } from './sources/related-files';
import { prioritizeFiles } from './prioritizer';
import { estimateTokens } from './token-counter';

export interface CollectionOptions {
  /** Whether to fetch full file contents for surrounding context */
  includeSurroundingCode: boolean;
  /** Whether to build dependency graph */
  includeDependencyGraph: boolean;
  /** Whether to fetch PR comments */
  includePRComments: boolean;
  /** Whether to fetch language config files */
  includeLanguageConfigs: boolean;
  /** Maximum files to fetch full content for */
  maxFullFiles: number;
  /** Whether to use AI to find related files from the repo (RAG) */
  includeRelatedFiles: boolean;
  /** Maximum related files to retrieve */
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
 * Collect comprehensive context for a PR analysis.
 */
export async function collectContext(
  owner: string,
  repo: string,
  prNumber: number,
  options: Partial<CollectionOptions> = {},
): Promise<CollectedContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // ═══ Phase 1: Fetch PR data (parallel) ═══
  const [prInfo, fileChanges, diff, commits] = await Promise.all([
    fetchPRInfo(owner, repo, prNumber),
    fetchPRFiles(owner, repo, prNumber),
    fetchPRDiff(owner, repo, prNumber),
    fetchPRCommits(owner, repo, prNumber),
  ]);

  // ═══ Phase 2: Optional context (parallel where possible) ═══
  const optionalFetches: Promise<any>[] = [];

  // Repo structure
  const repoStructurePromise = fetchRepoTree(owner, repo, prInfo.baseBranch)
    .then((tree) => tree.map((item) => item.path));

  // PR comments
  const commentsPromise = opts.includePRComments
    ? fetchPRComments(owner, repo, prNumber)
    : Promise.resolve([]);

  // Language configs
  const configsPromise = opts.includeLanguageConfigs
    ? fetchLanguageConfigs(owner, repo, prInfo.headSha, fileChanges)
    : Promise.resolve({});

  const [repoStructure, prComments, languageConfigs] = await Promise.all([
    repoStructurePromise,
    commentsPromise,
    configsPromise,
  ]);

  // ═══ Phase 3: File-level context extraction ═══
  let filesWithContext: FileWithContext[] = [];
  let dependencyGraph: DependencyGraph | null = null;

  if (opts.includeSurroundingCode && prInfo.headSha) {
    // Prioritize files to limit full-content fetches
    const priorities = prioritizeFiles(fileChanges);
    const topFiles = priorities.slice(0, opts.maxFullFiles).map((p) => p.file);

    filesWithContext = await extractSurroundingContext(
      owner, repo, prInfo.headSha, topFiles, diff,
    );
  }

  // ═══ Phase 4: Dependency graph ═══
  if (opts.includeDependencyGraph && filesWithContext.length > 0) {
    const contentMap = new Map<string, string>();
    for (const fwc of filesWithContext) {
      if (fwc.fullContent) {
        contentMap.set(fwc.path, fwc.fullContent);
      }
    }
    dependencyGraph = buildDependencyGraph(fileChanges, contentMap);
  }

  // ═══ Phase 5: AI-driven related file retrieval (RAG) ★ NEW ═══
  let relatedFiles: RelatedFile[] = [];
  if (opts.includeRelatedFiles && repoStructure.length > 0 && prInfo.headSha) {
    console.log(`[RAG] Finding related files in ${repoStructure.length} repo files...`);
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
      console.log(`[RAG] Found ${relatedFiles.length} related files.`);
    } catch (error) {
      console.warn('[RAG] Related file retrieval failed, continuing without:', error);
      relatedFiles = []; // Graceful degradation
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
 * Quick context collection — minimal data for fast scan.
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
 * Standard context collection — balanced speed and depth.
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
 * Deep context collection — maximum depth for thorough reviews.
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

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Fetch relevant language-specific config files.
 */
async function fetchLanguageConfigs(
  owner: string,
  repo: string,
  ref: string,
  fileChanges: FileChange[],
): Promise<Record<string, string>> {
  const configs: Record<string, string> = {};

  // Detect which config files to fetch based on changed files
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

  // Always try to get these
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
