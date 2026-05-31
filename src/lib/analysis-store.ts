import { prisma } from '@/lib/prisma';
import {
  AnalysisDepth as PrismaAnalysisDepth,
  AnalysisStatus,
  FileChangeStatus,
  ReviewCommentType,
  RiskLevel as PrismaRiskLevel,
  RiskSeverity,
} from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import type {
  AnalysisContextSnapshotData,
  AnalysisResponse,
  CollectedContext,
  FileChange,
  ReviewComment,
  Risk,
} from '@/types/analysis';

type AnalyzeDepth = 'fast' | 'standard' | 'deep';

const analysisInclude = {
  pullRequest: {
    include: {
      repository: true,
    },
  },
  risks: true,
  reviewComments: true,
  fileChanges: true,
  contextSnapshot: true,
} satisfies Prisma.AnalysisRunDefaultArgs['include'];

function toPrismaDepth(depth: AnalyzeDepth) {
  switch (depth) {
    case 'fast':
      return PrismaAnalysisDepth.FAST;
    case 'deep':
      return PrismaAnalysisDepth.DEEP;
    default:
      return PrismaAnalysisDepth.STANDARD;
  }
}

function fromPrismaDepth(depth: PrismaAnalysisDepth): AnalyzeDepth {
  switch (depth) {
    case PrismaAnalysisDepth.FAST:
      return 'fast';
    case PrismaAnalysisDepth.DEEP:
      return 'deep';
    default:
      return 'standard';
  }
}

function toPrismaRiskLevel(level: AnalysisResponse['riskLevel']) {
  switch (level) {
    case 'high':
      return PrismaRiskLevel.HIGH;
    case 'medium':
      return PrismaRiskLevel.MEDIUM;
    default:
      return PrismaRiskLevel.LOW;
  }
}

function fromPrismaRiskLevel(level: PrismaRiskLevel | null | undefined): AnalysisResponse['riskLevel'] {
  switch (level) {
    case PrismaRiskLevel.HIGH:
      return 'high';
    case PrismaRiskLevel.MEDIUM:
      return 'medium';
    default:
      return 'low';
  }
}

function toPrismaSeverity(severity: Risk['severity']) {
  switch (severity) {
    case 'critical':
      return RiskSeverity.CRITICAL;
    case 'high':
      return RiskSeverity.HIGH;
    case 'low':
      return RiskSeverity.LOW;
    default:
      return RiskSeverity.MEDIUM;
  }
}

function fromPrismaSeverity(severity: RiskSeverity): Risk['severity'] {
  switch (severity) {
    case RiskSeverity.CRITICAL:
      return 'critical';
    case RiskSeverity.HIGH:
      return 'high';
    case RiskSeverity.LOW:
      return 'low';
    default:
      return 'medium';
  }
}

function toPrismaCommentType(type: ReviewComment['type']) {
  switch (type) {
    case 'positive':
      return ReviewCommentType.POSITIVE;
    case 'concern':
      return ReviewCommentType.CONCERN;
    default:
      return ReviewCommentType.SUGGESTION;
  }
}

function fromPrismaCommentType(type: ReviewCommentType): ReviewComment['type'] {
  switch (type) {
    case ReviewCommentType.POSITIVE:
      return 'positive';
    case ReviewCommentType.CONCERN:
      return 'concern';
    default:
      return 'suggestion';
  }
}

function toPrismaFileStatus(status: FileChange['status']) {
  switch (status) {
    case 'added':
      return FileChangeStatus.ADDED;
    case 'deleted':
      return FileChangeStatus.DELETED;
    default:
      return FileChangeStatus.MODIFIED;
  }
}

function fromPrismaFileStatus(status: FileChangeStatus): FileChange['status'] {
  switch (status) {
    case FileChangeStatus.ADDED:
      return 'added';
    case FileChangeStatus.DELETED:
      return 'deleted';
    default:
      return 'modified';
  }
}

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) {
    return undefined;
  }

  return Number(value);
}

function buildPrUrl(owner: string, repo: string, prNumber: number) {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

type PersistedAnalysisRun = Prisma.AnalysisRunGetPayload<{ include: typeof analysisInclude }>;

function toContextSnapshot(snapshot: PersistedAnalysisRun['contextSnapshot']): AnalysisContextSnapshotData | undefined {
  if (!snapshot) {
    return undefined;
  }

  return {
    diff: snapshot.diff,
    diffTruncated: snapshot.diffTruncated,
    commits: snapshot.commits as unknown as AnalysisContextSnapshotData['commits'],
    prComments: snapshot.prComments as unknown as AnalysisContextSnapshotData['prComments'],
    repoStructure: snapshot.repoStructure as unknown as AnalysisContextSnapshotData['repoStructure'],
    languageConfigs: snapshot.languageConfigs as unknown as AnalysisContextSnapshotData['languageConfigs'],
    dependencyGraph: snapshot.dependencyGraph as unknown as AnalysisContextSnapshotData['dependencyGraph'],
    relatedFiles: snapshot.relatedFiles as unknown as AnalysisContextSnapshotData['relatedFiles'],
    filesWithContext: snapshot.filesWithContext as unknown as AnalysisContextSnapshotData['filesWithContext'],
  };
}

function toAnalysisResponse(run: PersistedAnalysisRun): AnalysisResponse {
  const repository = run.pullRequest.repository;
  const prInfo = {
    title: run.pullRequest.title,
    number: run.pullRequest.number,
    author: run.pullRequest.author,
    branch: run.pullRequest.branch,
    filesChanged: run.pullRequest.filesChanged,
    additions: run.pullRequest.additions,
    deletions: run.pullRequest.deletions,
    body: run.pullRequest.body,
    headSha: run.pullRequest.headSha,
    baseBranch: run.pullRequest.baseBranch,
  };

  return {
    analysisRunId: run.id,
    cacheHit: true,
    analyzedAt: (run.completedAt ?? run.createdAt).toISOString(),
    prUrl: buildPrUrl(repository.owner, repository.name, run.pullRequest.number),
    depth: fromPrismaDepth(run.depth),
    prInfo,
    summary: run.summary ?? '',
    riskLevel: fromPrismaRiskLevel(run.riskLevel),
    risks: run.risks.map((risk) => ({
      id: risk.externalId,
      severity: fromPrismaSeverity(risk.severity),
      title: risk.title,
      description: risk.description,
      file: risk.file,
      line: risk.line,
      code: risk.code,
      suggestion: risk.suggestion,
      confidence: (risk.confidence as Risk['confidence']) ?? 'medium',
      confidenceRationale: risk.confidenceRationale ?? undefined,
      category: risk.category as Risk['category'],
    })),
    reviewComments: run.reviewComments.map((comment) => ({
      id: comment.externalId,
      type: fromPrismaCommentType(comment.type),
      comment: comment.comment,
    })),
    fileChanges: run.fileChanges.map((fileChange) => ({
      file: fileChange.file,
      additions: fileChange.additions,
      deletions: fileChange.deletions,
      status: fromPrismaFileStatus(fileChange.status),
      blobUrl: fileChange.blobUrl ?? undefined,
      rawUrl: fileChange.rawUrl ?? undefined,
    })),
    modelUsed: run.modelUsed ?? undefined,
    provider: run.provider ?? undefined,
    latencyMs: run.latencyMs ?? undefined,
    tokenUsage:
      run.inputTokens != null && run.outputTokens != null
        ? {
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
          }
        : undefined,
    contextSnapshot: toContextSnapshot(run.contextSnapshot),
  };
}

export async function findCachedAnalysis(cacheKey: string) {
  const run = await prisma.analysisRun.findUnique({
    where: { cacheKey },
    include: analysisInclude,
  });

  if (!run || run.status !== AnalysisStatus.SUCCEEDED) {
    return null;
  }

  return toAnalysisResponse(run);
}

export async function getAnalysisById(analysisRunId: string) {
  const run = await prisma.analysisRun.findUnique({
    where: { id: analysisRunId },
    include: analysisInclude,
  });

  if (!run || run.status !== AnalysisStatus.SUCCEEDED) {
    return null;
  }

  return toAnalysisResponse(run);
}

export async function startAnalysisRun(params: {
  owner: string;
  repo: string;
  defaultBranch?: string;
  cacheKey: string;
  depth: AnalyzeDepth;
  collected: CollectedContext;
}) {
  const { owner, repo, defaultBranch, cacheKey, depth, collected } = params;
  const repository = await prisma.repository.upsert({
    where: {
      owner_name: {
        owner,
        name: repo,
      },
    },
    update: {
      fullName: `${owner}/${repo}`,
      defaultBranch: defaultBranch ?? collected.prInfo.baseBranch,
    },
    create: {
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      defaultBranch: defaultBranch ?? collected.prInfo.baseBranch,
    },
  });

  const pullRequest = await prisma.pullRequest.upsert({
    where: {
      repositoryId_number_headSha: {
        repositoryId: repository.id,
        number: collected.prInfo.number,
        headSha: collected.prInfo.headSha,
      },
    },
    update: {
      title: collected.prInfo.title,
      author: collected.prInfo.author,
      branch: collected.prInfo.branch,
      baseBranch: collected.prInfo.baseBranch,
      body: collected.prInfo.body,
      filesChanged: collected.prInfo.filesChanged,
      additions: collected.prInfo.additions,
      deletions: collected.prInfo.deletions,
    },
    create: {
      repositoryId: repository.id,
      number: collected.prInfo.number,
      title: collected.prInfo.title,
      author: collected.prInfo.author,
      branch: collected.prInfo.branch,
      baseBranch: collected.prInfo.baseBranch,
      body: collected.prInfo.body,
      headSha: collected.prInfo.headSha,
      filesChanged: collected.prInfo.filesChanged,
      additions: collected.prInfo.additions,
      deletions: collected.prInfo.deletions,
    },
  });

  return prisma.analysisRun.upsert({
    where: { cacheKey },
    update: {
      pullRequestId: pullRequest.id,
      status: AnalysisStatus.RUNNING,
      depth: toPrismaDepth(depth),
      summary: null,
      riskLevel: null,
      modelUsed: null,
      provider: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    },
    create: {
      cacheKey,
      status: AnalysisStatus.RUNNING,
      depth: toPrismaDepth(depth),
      pullRequestId: pullRequest.id,
    },
    include: {
      pullRequest: {
        include: {
          repository: true,
        },
      },
    },
  });
}

export async function completeAnalysisRun(params: {
  analysisRunId: string;
  data: AnalysisResponse;
  contextSnapshot: AnalysisContextSnapshotData;
}) {
  const { analysisRunId, data, contextSnapshot } = params;

  // 顺序执行而非事务，避免 P2028 事务超时
  await Promise.all([
    prisma.analysisRisk.deleteMany({ where: { analysisRunId } }),
    prisma.analysisReviewComment.deleteMany({ where: { analysisRunId } }),
    prisma.analysisFileChange.deleteMany({ where: { analysisRunId } }),
    prisma.analysisContextSnapshot.deleteMany({ where: { analysisRunId } }),
  ]);

  await prisma.analysisRun.update({
      where: { id: analysisRunId },
      data: {
        status: AnalysisStatus.SUCCEEDED,
        summary: data.summary,
        riskLevel: toPrismaRiskLevel(data.riskLevel),
        modelUsed: data.modelUsed,
        provider: data.provider,
        latencyMs: data.latencyMs,
        inputTokens: data.tokenUsage?.inputTokens,
        outputTokens: data.tokenUsage?.outputTokens,
        completedAt: new Date(data.analyzedAt ?? new Date().toISOString()),
        risks: {
          create: data.risks.map((risk) => ({
            externalId: risk.id,
            severity: toPrismaSeverity(risk.severity),
            title: risk.title,
            description: risk.description,
            file: risk.file,
            line: risk.line,
            code: risk.code,
            suggestion: risk.suggestion,
            confidence: risk.confidence,
            confidenceRationale: risk.confidenceRationale,
            category: risk.category,
          })),
        },
        reviewComments: {
          create: data.reviewComments.map((comment) => ({
            externalId: comment.id,
            type: toPrismaCommentType(comment.type),
            comment: comment.comment,
          })),
        },
        fileChanges: {
          create: data.fileChanges.map((fileChange) => ({
            file: fileChange.file,
            additions: fileChange.additions,
            deletions: fileChange.deletions,
            status: toPrismaFileStatus(fileChange.status),
            blobUrl: fileChange.blobUrl,
            rawUrl: fileChange.rawUrl,
          })),
        },
        contextSnapshot: {
          create: {
            diff: contextSnapshot.diff,
            diffTruncated: contextSnapshot.diffTruncated,
            commits: contextSnapshot.commits as unknown as Prisma.InputJsonValue,
            prComments: contextSnapshot.prComments as unknown as Prisma.InputJsonValue,
            repoStructure: contextSnapshot.repoStructure as unknown as Prisma.InputJsonValue,
            languageConfigs: contextSnapshot.languageConfigs as unknown as Prisma.InputJsonValue,
            dependencyGraph: (contextSnapshot.dependencyGraph ?? null) as unknown as Prisma.InputJsonValue | null,
            relatedFiles: contextSnapshot.relatedFiles as unknown as Prisma.InputJsonValue,
            filesWithContext: contextSnapshot.filesWithContext as unknown as Prisma.InputJsonValue,
          },
        },
      },
    })
}

export async function failAnalysisRun(params: {
  analysisRunId: string;
  errorCode: string;
  errorMessage: string;
}) {
  const { analysisRunId, errorCode, errorMessage } = params;

  await prisma.analysisRun.update({
    where: { id: analysisRunId },
    data: {
      status: AnalysisStatus.FAILED,
      errorCode,
      errorMessage,
      completedAt: new Date(),
    },
  });
}
