import { NextResponse } from 'next/server';
import { getAnalysisById } from '@/lib/analysis-store';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(_: Request, context: RouteContext) {
  const { id } = await context.params;

  const analysis = await getAnalysisById(id);
  if (!analysis) {
    return NextResponse.json(
      { error: '分析记录不存在或尚未完成' },
      { status: 404 },
    );
  }

  return NextResponse.json(analysis);
}
