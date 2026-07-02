/**
 * Curriculum Information Sheet — the single, detailed view of a student's
 * curriculum that Bob (Curriculum/L&C mode) and the change extractor both
 * read. Chapter-level detail (exact titles, status, descriptions, key
 * topics) is what lets Bob observe the real curriculum and lets extracted
 * change actions target specific chapters by name instead of guessing.
 *
 * Also carries the student's curriculum-relevant memory (interests,
 * preferences, aspirations, struggles) so changes fit the person, not just
 * the request.
 */
import prisma from '@/lib/prisma'

function safeParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try { return JSON.parse(str) as T } catch { return fallback }
}

export async function buildCurriculumSheet(userId: string): Promise<string> {
  const [tracks, plan] = await Promise.all([
    prisma.track.findMany({
      where: { userId },
      include: {
        chapters: {
          select: { title: true, status: true, sessionScore: true, description: true, keyTopics: true, estimatedMinutes: true },
          orderBy: { order: 'asc' },
        },
        projects: { select: { title: true, description: true, status: true, progress: true } },
        homeworks: { select: { title: true, status: true } },
      },
      orderBy: { order: 'asc' },
    }),
    prisma.curriculumPlan.findFirst({
      where: { userId },
      select: { version: true, generatedAt: true, lockedAt: true, profileSummary: true },
    }),
  ])

  const lockLine = plan?.lockedAt
    ? `LOCKED since ${new Date(plan.lockedAt).toDateString()} (unlocks ${new Date(new Date(plan.lockedAt).getTime() + 14 * 86_400_000).toDateString()})`
    : 'unlocked — changes allowed'

  const trackBlocks = tracks.length > 0
    ? tracks.map(t => {
        const done = t.chapters.filter(c => c.status === 'completed').length
        const chapterLines = t.chapters.map((c, i) => {
          const topics = safeParse<string[]>(c.keyTopics, [])
          const desc = (c.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 180)
          return `  ${i + 1}. "${c.title}" [${c.status}${c.sessionScore ? ` ${c.sessionScore}%` : ''}]`
            + (desc ? ` — ${desc}` : '')
            + (topics.length ? ` (topics: ${topics.slice(0, 6).join(', ')})` : '')
            + (c.estimatedMinutes ? ` (~${c.estimatedMinutes}min)` : '')
        }).join('\n')
        const projectLines = t.projects.length > 0
          ? t.projects.map(p => `  📌 Project: "${p.title}" [${p.status}, ${p.progress}%]${p.description ? ` — ${p.description.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`).join('\n')
          : '  📌 No project yet'
        const hwLine = t.homeworks.length > 0
          ? `  📝 Homework: ${t.homeworks.map(h => `${h.title} [${h.status}]`).join(', ')}`
          : ''
        return [
          `**${t.name}** [${t.type}]${t.description ? ` — ${t.description.replace(/\s+/g, ' ').slice(0, 160)}` : ''} (${done}/${t.chapters.length} chapters complete)`,
          chapterLines,
          projectLines,
          hwLine,
        ].filter(Boolean).join('\n')
      }).join('\n\n')
    : '(no tracks - curriculum not yet generated)'

  // Curriculum-relevant memory: what the student has said they want, like,
  // struggle with — the "remarks" that changes should fit.
  let remarks = ''
  try {
    const { getTopInsights } = await import('@/lib/insight-memory')
    const insights = await getTopInsights(userId, {
      limit: 8,
      types: ['interest', 'preference', 'aspiration', 'weakness', 'strength', 'struggle'],
    })
    if (insights.length > 0) {
      remarks = insights.map(i => `- [${i.type}] ${i.content}`).join('\n')
    }
  } catch { /* non-critical */ }

  return [
    `### CURRICULUM INFORMATION SHEET (plan v${plan?.version ?? '?'}, generated ${plan?.generatedAt ? new Date(plan.generatedAt).toDateString() : '?'}) — ${lockLine}`,
    plan?.profileSummary ? `Profile summary: ${plan.profileSummary.replace(/\s+/g, ' ').slice(0, 300)}` : '',
    '',
    trackBlocks,
    remarks ? `\n### STUDENT REMARKS & MEMORY (curriculum-relevant)\n${remarks}` : '',
  ].filter(Boolean).join('\n')
}
