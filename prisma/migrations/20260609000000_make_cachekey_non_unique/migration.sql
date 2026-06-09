-- Drop the unique constraint on cacheKey
ALTER TABLE "AnalysisRun" DROP CONSTRAINT IF EXISTS "AnalysisRun_cacheKey_key";

-- Add composite index for efficient cacheKey lookups
CREATE INDEX "AnalysisRun_cacheKey_createdAt_idx" ON "AnalysisRun"("cacheKey", "createdAt");
