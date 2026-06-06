import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  if (cookieStore.get('admin-auth')?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all assistant messages with metadata (token usage)
  const messages = await prisma.message.findMany({
    where: { role: 'assistant' },
    select: {
      id: true,
      metadata: true,
      createdAt: true,
      conversation: {
        select: { userId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let trackedMessages = 0
  let totalMessages = messages.length
  const modelBreakdown: Record<string, { input: number; output: number; count: number }> = {}
  const dailyUsage: Record<string, { input: number; output: number; count: number }> = {}
  const userUsage: Record<string, { input: number; output: number; count: number }> = {}

  for (const msg of messages) {
    if (!msg.metadata) continue
    try {
      const meta = JSON.parse(msg.metadata) as {
        inputTokens?: number
        outputTokens?: number
        model?: string
      }
      if (meta.inputTokens == null || meta.outputTokens == null) continue

      trackedMessages++
      totalInputTokens += meta.inputTokens
      totalOutputTokens += meta.outputTokens

      // Model breakdown
      const model = meta.model || 'unknown'
      if (!modelBreakdown[model]) modelBreakdown[model] = { input: 0, output: 0, count: 0 }
      modelBreakdown[model].input += meta.inputTokens
      modelBreakdown[model].output += meta.outputTokens
      modelBreakdown[model].count++

      // Daily breakdown (last 30 days)
      const day = msg.createdAt.toISOString().slice(0, 10)
      if (!dailyUsage[day]) dailyUsage[day] = { input: 0, output: 0, count: 0 }
      dailyUsage[day].input += meta.inputTokens
      dailyUsage[day].output += meta.outputTokens
      dailyUsage[day].count++

      // Per-user breakdown
      const userId = msg.conversation?.userId || 'unknown'
      if (!userUsage[userId]) userUsage[userId] = { input: 0, output: 0, count: 0 }
      userUsage[userId].input += meta.inputTokens
      userUsage[userId].output += meta.outputTokens
      userUsage[userId].count++
    } catch { /* skip invalid metadata */ }
  }

  const avgInputPerMessage = trackedMessages > 0 ? Math.round(totalInputTokens / trackedMessages) : 0
  const avgOutputPerMessage = trackedMessages > 0 ? Math.round(totalOutputTokens / trackedMessages) : 0
  const avgTotalPerMessage = avgInputPerMessage + avgOutputPerMessage

  // Estimate costs (approximate pricing)
  const costs: Record<string, { inputPer1M: number; outputPer1M: number }> = {
    'claude-opus-4-8': { inputPer1M: 15, outputPer1M: 75 },
    'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
    'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5 },
  }
  let estimatedCost = 0
  for (const [model, data] of Object.entries(modelBreakdown)) {
    const pricing = costs[model] || costs['claude-sonnet-4-6']
    estimatedCost += (data.input / 1_000_000) * pricing.inputPer1M
    estimatedCost += (data.output / 1_000_000) * pricing.outputPer1M
  }

  // Fetch user names/emails for the per-user breakdown
  const userIds = Object.keys(userUsage).filter(id => id !== 'unknown')
  const users = userIds.length > 0 ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, image: true },
  }) : []
  const userMap: Record<string, { name: string | null; email: string | null; image: string | null }> = {}
  for (const u of users) userMap[u.id] = { name: u.name, email: u.email, image: u.image }

  // Also count total messages per user (including non-tracked)
  const allUserMessages = await prisma.message.groupBy({
    by: ['conversationId'],
    where: { role: 'assistant' },
    _count: true,
  })
  const convToUser = await prisma.conversation.findMany({
    select: { id: true, userId: true },
  })
  const convUserMap: Record<string, string> = {}
  for (const c of convToUser) convUserMap[c.id] = c.userId
  const totalMsgByUser: Record<string, number> = {}
  for (const g of allUserMessages) {
    const uid = convUserMap[g.conversationId] || 'unknown'
    totalMsgByUser[uid] = (totalMsgByUser[uid] || 0) + g._count
  }

  // Build per-user stats with cost estimates
  const perUserStats = Object.entries(userUsage).map(([userId, data]) => {
    const total = data.input + data.output
    // Estimate cost for this user's tokens (use average model pricing as approximation)
    let userCost = 0
    if (estimatedCost > 0 && (totalInputTokens + totalOutputTokens) > 0) {
      userCost = estimatedCost * (total / (totalInputTokens + totalOutputTokens))
    }
    return {
      userId,
      name: userMap[userId]?.name || null,
      email: userMap[userId]?.email || null,
      image: userMap[userId]?.image || null,
      inputTokens: data.input,
      outputTokens: data.output,
      totalTokens: total,
      trackedMessages: data.count,
      totalMessages: totalMsgByUser[userId] || data.count,
      avgInputPerMessage: data.count > 0 ? Math.round(data.input / data.count) : 0,
      avgOutputPerMessage: data.count > 0 ? Math.round(data.output / data.count) : 0,
      avgTotalPerMessage: data.count > 0 ? Math.round(total / data.count) : 0,
      estimatedCost: Math.round(userCost * 100) / 100,
    }
  }).sort((a, b) => b.totalTokens - a.totalTokens)

  return NextResponse.json({
    totalMessages,
    trackedMessages,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    avgInputPerMessage,
    avgOutputPerMessage,
    avgTotalPerMessage,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    modelBreakdown,
    dailyUsage,
    perUserStats,
  })
}
