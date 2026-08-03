import { NextResponse } from 'next/server';
import { siteConfig } from '@/lib/site';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(siteConfig);
}