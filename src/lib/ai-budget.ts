/**
 * PER-USER DAILY AI BUDGET — the guard that makes depth affordable instead
 * of something to throttle later (deep-audit §16): without a ceiling, the
 * most expensive learner is the one doing exactly what the vision asks.
 *
 * Sums the last 24h of UsageEvent.costUsd for the user and compares against
 * DAILY_AI_BUDGET_USD (env; default $15 — roughly 3-5 fully-verified nodes
 * of Opus teaching a day). Enforced at the two expensive doors (node chat,
 * tree copilot); background passes and judging are never blocked — a learner
 * mid-checkpoint must always get their verdict.
 *
 * Fail-open: a telemetry outage must never lock anyone out of learning.
 */
import prisma from '@/lib/prisma'

const DEFAULT_DAILY_USD = 15

export function dailyBudgetUsd(): number {
  const raw = Number(process.env.DAILY_AI_BUDGET_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_USD
}

export async function checkDailyBudget(userId: string): Promise<{ ok: boolean; spentUsd: number; limitUsd: number }> {
  const limitUsd = dailyBudgetUsd()
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const agg = await prisma.usageEvent.aggregate({
      where: { userId, createdAt: { gte: since } },
      _sum: { costUsd: true },
    })
    const spentUsd = agg._sum.costUsd ?? 0
    return { ok: spentUsd < limitUsd, spentUsd, limitUsd }
  } catch {
    return { ok: true, spentUsd: 0, limitUsd }
  }
}

/** Localized over-budget message for the chat/copilot doors. */
export function budgetMessage(zh: boolean): string {
  return zh
    ? '今天的 AI 学习额度已用完——明天会自动恢复。已验证的进度都已保存，你可以继续查看笔记、讲解和树。'
    : "You've used today's AI learning budget — it resets automatically tomorrow. All verified progress is saved, and your notes, explainers, and tree stay fully available."
}
