import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

declare global {
  var prismaClientSingleton: PrismaClient | undefined;
}

/**
 * Fallback database connection URL
 * Used when DATABASE_URL environment variable is not configured
 */
const FALLBACK_DATABASE_URL = 'postgresql://postgres.edyigvifjnmkypldnmvq:5if72ksoS2jI7mDz@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true';

function createPrismaClient() {
  // Use environment variable if available, otherwise use fallback
  const connectionString = process.env.DATABASE_URL || FALLBACK_DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured and no fallback is available');
  }

  // Log which connection is being used (only in development)
  if (process.env.NODE_ENV !== 'production') {
    const isUsingFallback = !process.env.DATABASE_URL;
    console.log(
      `[Prisma] Using ${isUsingFallback ? 'fallback' : 'environment'} database connection`
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
  });
}

export const prisma = globalThis.prismaClientSingleton ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaClientSingleton = prisma;
}
