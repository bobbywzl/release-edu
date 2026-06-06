import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

export async function POST() {
  const userId = await getUserId()

  // Check curriculum lock — cannot reset while locked
  const plan = await prisma.curriculumPlan.findFirst({ where: { userId }, select: { lockedAt: true } })
  if (plan?.lockedAt) {
    const lockEnd = new Date(plan.lockedAt)
    lockEnd.setDate(lockEnd.getDate() + 30)
    if (new Date() < lockEnd) {
      return NextResponse.json({ error: 'Curriculum is locked. Cannot reset during the lock period.', lockedUntil: lockEnd.toISOString() }, { status: 403 })
    }
  }

  // ── Archive current curriculum as a CurriculumBlock ──

  const curriculumPlan = await prisma.curriculumPlan.findFirst({ where: { userId } })
  const tracks = await prisma.track.findMany({
    where: { userId },
    include: {
      chapters: { select: { id: true, title: true, status: true, sessionScore: true, keyTopics: true, description: true, order: true } },
      modules: { select: { title: true, status: true, progress: true } },
    },
    orderBy: { order: 'asc' },
  })
  const insights = await prisma.insight.findMany({ where: { userId }, select: { type: true, content: true, confidence: true } })
  const sessionOutcomes = await prisma.sessionOutcome.findMany({
    where: { userId },
    select: { chapterId: true, subjectArea: true, endScore: true, passed: true, messageCount: true, sessionSummary: true },
  })
  const highlights = await prisma.messageHighlight.findMany({
    where: { userId },
    select: { selectedText: true, comment: true, color: true },
  })
  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { xp: true } })

  let archiveId: string | null = null
  // Only archive if there's actual curriculum data
  if (curriculumPlan && tracks.length > 0) {
    const totalChapters = tracks.reduce((sum, t) => sum + t.chapters.length, 0)
    const completedChapters = tracks.reduce((sum, t) => sum + t.chapters.filter(c => c.status === 'completed').length, 0)
    const overallProgress = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0

    // Build a descriptive title from primary interests
    const interests: string[] = curriculumPlan.primaryInterests
      ? JSON.parse(curriculumPlan.primaryInterests)
      : tracks.slice(0, 2).map(t => t.name)
    const title = interests.slice(0, 3).join(', ') || 'Curriculum'

    const tracksJson = tracks.map(t => ({
      name: t.name,
      type: t.type,
      color: t.color,
      progress: t.progress,
      chapters: t.chapters.map(c => ({
        title: c.title,
        status: c.status,
        sessionScore: c.sessionScore,
        keyTopics: c.keyTopics,
      })),
    }))

    const block = await prisma.curriculumBlock.create({
      data: {
        userId,
        title,
        profileSummary: curriculumPlan.profileSummary,
        primaryInterests: curriculumPlan.primaryInterests,
        primaryStrengths: curriculumPlan.primaryStrengths,
        learningStyle: curriculumPlan.learningStyle,
        totalChapters,
        completedChapters,
        totalXp: profile?.xp || 0,
        overallProgress,
        tracksJson: JSON.stringify(tracksJson),
        insightsJson: insights.length > 0 ? JSON.stringify(insights) : null,
        sessionOutcomesJson: sessionOutcomes.length > 0 ? JSON.stringify(sessionOutcomes) : null,
        highlightsJson: highlights.length > 0 ? JSON.stringify(highlights) : null,
        startedAt: curriculumPlan.generatedAt,
        lockedAt: curriculumPlan.lockedAt,
      },
    })
    archiveId = block.id

    // Enforce per-user archive cap: keep only the 2 most recent CurriculumBlocks.
    // Older archives are dropped so the DB doesn't accumulate stale history.
    await pruneOldArchives(userId, 2)
  }

  // ── Clean up current curriculum, but PRESERVE everything that represents
  //    the user's identity and earned achievements ──
  //
  // DELETED (curriculum-specific, will be regenerated):
  //   - Track / CurriculumPlan / Chapter / Module / Project rows
  //   - Conversations + Messages + their archives (tied to chapters)
  //   - MessageHighlight / MessageFeedback (tied to messages)
  //   - Low-confidence insights (transient signals; high-confidence kept)
  //
  // PRESERVED (user state, achievements, personalization):
  //   - PortfolioCache (achievements; user explicitly asked for this)
  //   - LinkedFile (user-uploaded files belong to the user, not the curriculum)
  //   - High-confidence insights (>= 0.7 — persist across curricula)
  //   - StudentProfile.{interests, strengths, weaknesses, learningStyle,
  //     aspirations, pacePreference, currentProjects} — personalization data
  //     gathered from past onboarding, used to seed the next one
  //   - StudentProfile._profileMeta (name, age, education, occupation)
  //   - XP, streak, MentorConfig — cumulative across curricula
  //   - CurriculumBlock(s) just archived — basis for restore window
  await prisma.messageHighlight.deleteMany({ where: { userId } })
  await prisma.messageFeedback.deleteMany({ where: { userId } })
  await prisma.conversation.deleteMany({ where: { userId } })
  await prisma.conversationArchive.deleteMany({ where: { userId } })
  await prisma.track.deleteMany({ where: { userId } })
  await prisma.curriculumPlan.deleteMany({ where: { userId } })
  await prisma.insight.deleteMany({ where: { userId, confidence: { lt: 0.7 } } })

  // Flip onboarded flag, reset learning stage, and clear the regeneration
  // counter. Personalization fields (interests, strengths, etc.) stay intact
  // — they'll be refined (not overwritten blindly) by the new onboarding
  // conversation. The regeneration counter resets here because each new
  // curriculum lifecycle gets its own 2-use budget.
  await prisma.studentProfile.updateMany({
    where: { userId },
    data: {
      isOnboarded: false,
      learningStage: 1,
      manualRegenerationCount: 0,
    },
  })

  return NextResponse.json({ success: true, archived: archiveId !== null, archiveId })
}

/**
 * Keep the most recent `keep` CurriculumBlock rows for a user, delete the rest.
 * Runs after each new archive is created so the user's history doesn't grow
 * unbounded. Safe to call when fewer than `keep` archives exist (no-op).
 */
async function pruneOldArchives(userId: string, keep: number): Promise<void> {
  try {
    const all = await prisma.curriculumBlock.findMany({
      where: { userId },
      orderBy: { archivedAt: 'desc' },
      select: { id: true },
    })
    if (all.length <= keep) return
    const toDelete = all.slice(keep).map(b => b.id)
    await prisma.curriculumBlock.deleteMany({ where: { id: { in: toDelete } } })
    console.log(`[ArchivePrune] Deleted ${toDelete.length} old curriculum archive(s) for user ${userId}`)
  } catch (err) {
    console.error('[ArchivePrune] Failed:', err)
  }
}
