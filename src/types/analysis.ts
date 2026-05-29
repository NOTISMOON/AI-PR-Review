// ─── PR Information ──────────────────────────────────────────────────

export interface PRInfo {
  title: string;
  number: number;
  author: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  /** PR description/body — NEW */
  body: string;
  /** Head commit SHA — for cache keying and file fetching — NEW */
  headSha: string;
  /** Base branch name — NEW */
  baseBranch: string;
}

// ─── Risk Analysis ───────────────────────────────────────────────────

export interface Risk {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  file: string;
  line: number;
  code: string;
  suggestion: string;
  /** Confidence in this finding — NEW */
  confidence: 'high' | 'medium' | 'low';
  /** Why the model is uncertain (for medium/low confidence) — NEW */
  confidenceRationale?: string;
  /** Category of the risk — NEW */
  category?: 'security' | 'logic' | 'performance' | 'quality' | 'architecture';
}

// ─── Review Comments ─────────────────────────────────────────────────

export interface ReviewComment {
  id: string;
  type: 'positive' | 'suggestion' | 'concern';
  comment: string;
}

// ─── File Changes ────────────────────────────────────────────────────

export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted';
  /** Blob URL for full file content fetch — NEW */
  blobUrl?: string;
  /** Raw URL — NEW */
  rawUrl?: string;
}

// ─── Commit Information — NEW ────────────────────────────────────────

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}

// ─── Dependency Graph — NEW ──────────────────────────────────────────

export interface DependencyEdge {
  /** Source file */
  from: string;
  /** Target file being imported */
  to: string;
  /** Import type */
  type: 'import' | 'require' | 'dynamic-import';
}

export interface DependencyGraph {
  /** All edges in the dependency graph */
  edges: DependencyEdge[];
  /** Files that depend on changed files but are NOT in the change list */
  externalDependents: string[];
}

// ─── Related Files (RAG) — NEW ─────────────────────────────────────

export interface RelatedFile {
  path: string;
  /** AI-generated reason why this file is related to the changes */
  reason: string;
  /** Relevance level */
  relevance: 'high' | 'medium' | 'low';
  /** Full file content (may be null if fetch failed) */
  content: string | null;
  /** Specific code sections related to the changes */
  relevantSections: {
    type: 'function' | 'class' | 'method' | 'test' | 'config' | 'interface' | 'module';
    name: string;
    code: string;
    startLine: number;
    endLine: number;
  }[];
}

export interface AIRetrievalResult {
  relatedFiles: {
    path: string;
    reason: string;
    relevance: 'high' | 'medium' | 'low';
  }[];
}

// ─── Context Collection ────────────────────────────────────────────

export interface FileWithContext {
  path: string;
  fullContent: string | null;
  /** Functions/classes surrounding the changes */
  surroundingContext: SurroundingBlock[];
  status: 'added' | 'modified' | 'deleted';
}

export interface SurroundingBlock {
  /** Type of code block */
  type: 'function' | 'class' | 'method' | 'interface' | 'module';
  /** Name of the block */
  name: string;
  /** Starting line in the file */
  startLine: number;
  /** Ending line */
  endLine: number;
  /** The full code of this block */
  code: string;
  /** Whether changes exist within this block */
  hasChanges: boolean;
}

export interface CollectedContext {
  prInfo: PRInfo;
  fileChanges: FileChange[];
  commits: CommitInfo[];
  diff: string;
  filesWithContext: FileWithContext[];
  dependencyGraph: DependencyGraph | null;
  repoStructure: string[];
  prComments: { author: string; body: string; createdAt: string }[];
  languageConfigs: Record<string, string>;
  /** AI-retrieved related files from the broader repository — NEW */
  relatedFiles: RelatedFile[];
}

// ─── Analysis Results ────────────────────────────────────────────────

export interface AnalysisData {
  prInfo: PRInfo;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  risks: Risk[];
  reviewComments: ReviewComment[];
  fileChanges: FileChange[];
  /** Model used for the analysis — NEW */
  modelUsed?: string;
  /** Provider used — NEW */
  provider?: string;
  /** Estimated cost in USD — NEW */
  estimatedCost?: number;
  /** Analysis latency in ms — NEW */
  latencyMs?: number;
  /** Token usage — NEW */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── API Types ───────────────────────────────────────────────────────

export interface AnalyzeRequest {
  prUrl: string;
  /** Preferred model ID — NEW */
  preferredModel?: string;
  /** Analysis depth — NEW */
  depth?: 'fast' | 'standard' | 'deep';
  /** Whether to use ensemble mode — NEW */
  ensembleMode?: boolean;
}

export interface AnalyzeError {
  error: string;
  code:
    | 'INVALID_URL'
    | 'GITHUB_ERROR'
    | 'AI_ERROR'
    | 'AI_PARSE_ERROR'
    | 'AI_RATE_LIMIT'
    | 'AI_CONFIG_ERROR'
    | 'RATE_LIMIT'
    | 'NOT_FOUND'
    | 'INTERNAL_ERROR';
}

// ─── Streaming Types — NEW ───────────────────────────────────────────

export type SSEEventType = 'progress' | 'partial' | 'complete' | 'error';

export interface SSEProgressEvent {
  type: 'progress';
  phase: 'fetching' | 'analyzing' | 'validating';
  message: string;
}

export interface SSEPartialEvent {
  type: 'partial';
  payloadType: 'summary' | 'risk' | 'comment';
  content?: string;
  risk?: Risk;
  comment?: ReviewComment;
}

export interface SSECompleteEvent {
  type: 'complete';
  riskLevel: 'low' | 'medium' | 'high';
  totalRisks: number;
  totalComments: number;
  modelUsed: string;
  estimatedCost: number;
  latencyMs: number;
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
  code: string;
}

export type SSEEvent = SSEProgressEvent | SSEPartialEvent | SSECompleteEvent | SSEErrorEvent;

// ─── User Feedback — NEW ─────────────────────────────────────────────

export interface FeedbackEntry {
  riskId: string;
  prUrl: string;
  rating: 'accurate' | 'inaccurate' | 'partially_accurate';
  category?: 'not-a-real-issue' | 'wrong-severity' | 'wrong-location' | 'bad-suggestion';
  userComment?: string;
  correctedSeverity?: string;
  timestamp: string;
}

// ─── Settings — NEW ──────────────────────────────────────────────────

export interface UserSettings {
  preferredModel?: string;
  depth: 'fast' | 'standard' | 'deep';
  outputLanguage: 'zh' | 'en';
  strictness: 'lenient' | 'balanced' | 'strict';
  ignorePatterns: string[];
  ensembleMode: boolean;
}
