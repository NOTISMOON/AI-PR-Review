ALTER TABLE "AnalysisRun"
ADD COLUMN "degradedFromReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "degradedReason" TEXT;
