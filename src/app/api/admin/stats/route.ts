import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Comprehensive AI cost + usage analytics, sourced from the UsageEvent table
// (one row per model call across the whole app). Breaks spend down by model,
// feature, provider, day, and user — with real $ cost computed at write time.
export async function GET() {
  const denied = await adminApiGuard(); if (denied) return denied

  // Bound the window so the table stays cheap as data grows.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const events = await prisma.usageEvent.findMany({
    where: { createdAt: { gte: since } },
    select: {
      userId: true, provider: true, model: true, feature: true,
      inputTokens: true, outputTokens: true, cacheReadTokens: true,
      cacheWriteTokens: true, costUsd: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  let totalInputTokens = 0, totalOutputTokens = 0, totalCacheReadTokens = 0, totalCacheWriteTokens = 0, totalCostUsd = 0

  type Bucket = { input: number; output: number; cacheRead: number; cacheWrite: number; tokens: number; costUsd: number; events: number }
  const newBucket = (): Bucket => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, costUsd: 0, events: 0 })
  const byModel: Record<string, Bucket & { provider: string }> = {}
  const byFeature: Record<string, Bucket> = {}
  const byProvider: Record<string, Bucket> = {}
  const daily: Record<string, Bucket> = {}
  const byUser: Record<string, Bucket> = {}

  // Cost over the last 7 days, for monthly projection.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  let last7dCost = 0

  const add = (b: Bucket, e: typeof events[number]) => {
    const tokens = e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens
    b.input += e.inputTokens
    b.output += e.outputTokens
    b.cacheRead += e.cacheReadTokens
    b.cacheWrite += e.cacheWriteTokens
    b.tokens += tokens
    b.costUsd += e.costUsd
    b.events += 1
  }

  for (const e of events) {
    totalInputTokens += e.inputTokens
    totalOutputTokens += e.outputTokens
    totalCacheReadTokens += e.cacheReadTokens
    totalCacheWriteTokens += e.cacheWriteTokens
    totalCostUsd += e.costUsd
    if (e.createdAt.getTime() >= sevenDaysAgo) last7dCost += e.costUsd

    if (!byModel[e.model]) byModel[e.model] = { ...newBucket(), provider: e.provider }
    add(byModel[e.model], e)
    if (!byFeature[e.feature]) byFeature[e.feature] = newBucket()
    add(byFeature[e.feature], e)
    if (!byProvider[e.provider]) byProvider[e.provider] = newBucket()
    add(byProvider[e.provider], e)
    const day = e.createdAt.toISOString().slice(0, 10)
    if (!daily[day]) daily[day] = newBucket()
    add(daily[day], e)
    const uid = e.userId || 'system'
    if (!byUser[uid]) byUser[uid] = newBucket()
    add(byUser[uid], e)
  }

  // Resolve user identities for the per-user table.
  const userIds = Object.keys(byUser).filter(id => id !== 'system')
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, image: true } })
    : []
  const userMap: Record<string, { name: string | null; email: string | null; image: string | null }> = {}
  for (const u of users) userMap[u.id] = { name: u.name, email: u.email, image: u.image }

  const round = (n: number) => Math.round(n * 10000) / 10000

  return NextResponse.json({
    totalEvents: events.length,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    totalTokens: totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens,
    totalCostUsd: round(totalCostUsd),
    projectedMonthlyUsd: round((last7dCost / 7) * 30),
    windowDays: 90,
    byModel: Object.entries(byModel)
      .map(([model, b]) => ({ model, provider: b.provider, tokens: b.tokens, input: b.input, output: b.output, cacheRead: b.cacheRead, cacheWrite: b.cacheWrite, costUsd: round(b.costUsd), events: b.events }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byFeature: Object.entries(byFeature)
      .map(([feature, b]) => ({ feature, tokens: b.tokens, costUsd: round(b.costUsd), events: b.events }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byProvider: Object.entries(byProvider)
      .map(([provider, b]) => ({ provider, tokens: b.tokens, costUsd: round(b.costUsd), events: b.events }))
      .sort((a, b) => b.costUsd - a.costUsd),
    daily: Object.entries(daily)
      .map(([day, b]) => ({ day, costUsd: round(b.costUsd), tokens: b.tokens, events: b.events }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    perUser: Object.entries(byUser)
      .map(([userId, b]) => ({
        userId,
        name: userId === 'system' ? 'System / background' : (userMap[userId]?.name || null),
        email: userId === 'system' ? null : (userMap[userId]?.email || null),
        image: userId === 'system' ? null : (userMap[userId]?.image || null),
        tokens: b.tokens,
        inputTokens: b.input,
        outputTokens: b.output,
        costUsd: round(b.costUsd),
        events: b.events,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
  })
}
