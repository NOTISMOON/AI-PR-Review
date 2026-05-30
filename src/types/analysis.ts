export interface PRInfo {
  title: string;
  number: number;
  author: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  body: string;
  headSha: string;
  baseBranch: string;
}

export interface Risk {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  file: string;
  line: number;
  code: string;
  suggestion: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceRationale?: string;
  category?: 'security' | 'logic' | 'performance' | 'quality' | 'architecture';
}

export interface ReviewComment {
  id: string;
  type: 'positive' | 'suggestion' | 'concern';
  comment: string;
}

export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted';
  blobUrl?: string;
  rawUrl?: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'require' | 'dynamic-import';
}

export interface DependencyGraph {
  edges: DependencyEdge[];
  externalDependents: string[];
}

export interface RelatedFileSection {
  type: 'function' | 'class' | 'method' | 'test' | 'config' | 'interface' | 'module';
  name: string;
  code: string;
  startLine: number;
  endLine: number;
}

export interface RelatedFile {
  path: string;
  reason: string;
  relevance: 'high' | 'medium' | 'low';
  content: string | null;
  relevantSections: RelatedFileSection[];
}

export interface AIRetrievalResult {
  relatedFiles: {
    path: string;
    reason: string;
    relevance: 'high' | 'medium' | 'low';
  }[];
}

export interface SurroundingBlock {
  type: 'function' | 'class' | 'method' | 'interface' | 'module';
  name: string;
  startLine: number;
  endLine: number;
  code: string;
  hasChanges: boolean;
}

export interface FileWithContext {
  path: string;
  fullContent: string | null;
  surroundingContext: SurroundingBlock[];
  status: 'added' | 'modified' | 'deleted';
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
  relatedFiles: RelatedFile[];
}

export interface AnalysisContextSnapshotData {
  diff: string;
  diffTruncated: boolean;
  commits: CommitInfo[];
  prComments: { author: string; body: string; createdAt: string }[];
  repoStructure: string[];
  languageConfigs: Record<string, string>;
  dependencyGraph: DependencyGraph | null;
  relatedFiles: RelatedFile[];
  filesWithContext: FileWithContext[];
}

export interface AnalysisData {
  prInfo: PRInfo;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  risks: Risk[];
  reviewComments: ReviewComment[];
  fileChanges: FileChange[];
  modelUsed?: string;
  provider?: string;
  estimatedCost?: number;
  latencyMs?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AnalysisResponse extends AnalysisData {
  analysisRunId?: string;
  cacheHit?: boolean;
  analyzedAt?: string;
  prUrl?: string;
  depth?: 'fast' | 'standard' | 'deep';
  contextSnapshot?: AnalysisContextSnapshotData;
}

export interface AnalyzeRequest {
  prUrl: string;
  preferredModel?: string;
  depth?: 'fast' | 'standard' | 'deep';
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

export interface FeedbackEntry {
  riskId: string;
  prUrl: string;
  rating: 'accurate' | 'inaccurate' | 'partially_accurate';
  category?: 'not-a-real-issue' | 'wrong-severity' | 'wrong-location' | 'bad-suggestion';
  userComment?: string;
  correctedSeverity?: string;
  timestamp: string;
}

export interface UserSettings {
  preferredModel?: string;
  depth: 'fast' | 'standard' | 'deep';
  outputLanguage: 'zh' | 'en';
  strictness: 'lenient' | 'balanced' | 'strict';
  ignorePatterns: string[];
  ensembleMode: boolean;
}

export interface LocalAnalysisHistoryEntry {
  analysisRunId: string;
  prUrl: string;
  savedAt: string;
  data: AnalysisResponse;
}
