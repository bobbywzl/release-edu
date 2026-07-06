/**
 * ensureUserRow — guarantee the User row exists before any FK-dependent
 * write. Every active table (ProblemTree, Conversation, Insight,
 * StudentProfile, UserBadge…) FKs onto User, but demo visitors and
 * first-action users historically had no row, so their first write 502'd
 * AFTER the AI call was already paid for (simulation finding: two billed
 * tree-seeds, zero trees).
 *
 * Demo rows are ephemeral by design — the cleanup-demo cron deletes
 * `demo-*` users after 24h.
 */
import prisma from '@/lib/prisma'

export async function ensureUserRow(userId: string): Promise<void> {
  if (!userId) return
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (existing) return

  const isDemo = userId.startsWith('demo-')
  let email = isDemo ? `${userId}@release.edu` : `placeholder-${userId}@pending.edu`
  let name: string | undefined = isDemo ? 'Demo Student' : undefined
  if (!isDemo) {
    try {
      const { getUserInfo } = await import('@/lib/get-user-id')
      const info = await getUserInfo()
      if (info.email) email = info.email
      if (info.name) name = info.name
    } catch { /* not in request context */ }
  }
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email, name },
  })
}
