-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisDepth" AS ENUM ('FAST', 'STANDARD', 'DEEP');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ReviewCommentType" AS ENUM ('POSITIVE', 'SUGGESTION', 'CONCERN');

-- CreateEnum
CREATE TYPE "FileChangeStatus" AS ENUM ('ADDED', 'MODIFIED', 'DELETED');

-- CreateEnum
CREATE TYPE "RelatedFileRelevance" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "headSha" TEXT NOT NULL,
    "filesChanged" INTEGER NOT NULL,
    "additions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL,
    "depth" "AnalysisDepth" NOT NULL,
    "summary" TEXT,
    "riskLevel" "RiskLevel",
    "modelUsed" TEXT,
    "provider" TEXT,
    "estimatedCost" DECIMAL(10,6),
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRisk" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "confidenceRationale" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisReviewComment" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" "ReviewCommentType" NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisFileChange" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "additions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "status" "FileChangeStatus" NOT NULL,
    "blobUrl" TEXT,
    "rawUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisFileChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisContextSnapshot" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    "diffTruncated" BOOLEAN NOT NULL DEFAULT false,
    "commits" JSONB NOT NULL,
    "prComments" JSONB NOT NULL,
    "repoStructure" JSONB NOT NULL,
    "languageConfigs" JSONB NOT NULL,
    "dependencyGraph" JSONB,
    "relatedFiles" JSONB NOT NULL,
    "filesWithContext" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisContextSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_owner_name_key" ON "Repository"("owner", "name");

-- CreateIndex
CREATE INDEX "PullRequest_repositoryId_number_idx" ON "PullRequest"("repositoryId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repositoryId_number_headSha_key" ON "PullRequest"("repositoryId", "number", "headSha");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRun_cacheKey_key" ON "AnalysisRun"("cacheKey");

-- CreateIndex
CREATE INDEX "AnalysisRun_pullRequestId_createdAt_idx" ON "AnalysisRun"("pullRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_status_createdAt_idx" ON "AnalysisRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRisk_analysisRunId_severity_idx" ON "AnalysisRisk"("analysisRunId", "severity");

-- CreateIndex
CREATE INDEX "AnalysisRisk_file_line_idx" ON "AnalysisRisk"("file", "line");

-- CreateIndex
CREATE INDEX "AnalysisReviewComment_analysisRunId_idx" ON "AnalysisReviewComment"("analysisRunId");

-- CreateIndex
CREATE INDEX "AnalysisFileChange_analysisRunId_file_idx" ON "AnalysisFileChange"("analysisRunId", "file");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisContextSnapshot_analysisRunId_key" ON "AnalysisContextSnapshot"("analysisRunId");

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRisk" ADD CONSTRAINT "AnalysisRisk_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisReviewComment" ADD CONSTRAINT "AnalysisReviewComment_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisFileChange" ADD CONSTRAINT "AnalysisFileChange_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisContextSnapshot" ADD CONSTRAINT "AnalysisContextSnapshot_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
