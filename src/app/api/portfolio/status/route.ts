import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export const dynamic = 'force-dynamic'

export async function GET() {
  const userId = await getUserId()
  const cache = await prisma.portfolioCache.findUnique({ where: { userId } })

  if (!cache) {
    return NextResponse.json({ status: 'none' })
  }

  // If generation started more than 5 minutes ago, consider it stale/timed out
  if (cache.status === 'generating' && cache.startedAt) {
    const age = Date.now() - cache.startedAt.getTime()
    if (age > 5 * 60 * 1000) {
      await prisma.portfolioCache.update({
        where: { userId },
        data: { status: 'error', errorMessage: 'Generation timed out' },
      })
      return NextResponse.json({ status: 'error', error: 'Generation timed out' })
    }
    return NextResponse.json({ status: 'generating', startedAt: cache.startedAt })
  }

  if (cache.status === 'error') {
    return NextResponse.json({ status: 'error', error: cache.errorMessage })
  }

  // Ready
  try {
    const portfolio = JSON.parse(cache.data)
    return NextResponse.json({ status: 'ready', portfolio, generatedAt: cache.generatedAt })
  } catch {
    return NextResponse.json({ status: 'error', error: 'Stored portfolio is corrupted' })
  }
}
