import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { adminApiGuard } from '@/lib/admin-auth'
import { getLevelForXp, getRank, DAILY_GOAL_XP, userDayKey } from '@/lib/xp-engine'
import { parseQuizState } from '@/lib/mastery'
import { BADGES } from '@/lib/badges'

export const dynamic = 'force-dynamic'

const VALID_ROLES = ['student', 'mentor', 'admin'] as const

// Emails that are permanent owners — they can never be demoted or deleted via
// the admin UI, so an admin can't lock everyone (including the owner) out.
function ownerEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

// Admin actions: change role, reset onboarding.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await adminApiGuard(); if (denied) return denied

  const { id } = await params
  const body = await req.json() as { action: string; role?: string }

  if (body.action === 'set_role') {
    const role = body.role
    if (!role || !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }
    const target = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true } })
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    // Never let a bootstrap owner be demoted out of admin.
    if (role !== 'admin' && target.email && ownerEmails().includes(target.email.toLowerCase())) {
      return NextResponse.json({ error: 'This account is a permanent owner (set via ADMIN_EMAILS) and cannot be demoted.' }, { status: 403 })
    }
    await prisma.user.update({ where: { id }, data: { role } })
    return NextResponse.json({ success: true, message: `Role changed to ${role}` })
  }

  if (body.action === 'reset_onboarding') {
    await prisma.studentProfile.updateMany({
      where: { userId: id },
      data: { isOnboarded: false },
    })
    return NextResponse.json({ success: true, message: 'Onboarding reset' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// Permanently delete a user and ALL their data. Every User relation is
// onDelete: Cascade, so a single delete removes profile, conversations,
// problem trees, insights, files, etc. Irreversible.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await adminApiGuard(); if (denied) return denied

  const { id } = await params
  const target = await prisma.user.findUnique({ where: { id }, select: { email: true } })
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const targetEmail = target.email?.toLowerCase()
  // Guard 1: never delete a permanent owner.
  if (targetEmail && ownerEmails().includes(targetEmail)) {
    return NextResponse.json({ error: 'This account is a permanent owner and cannot be deleted.' }, { status: 403 })
  }
  // Guard 2: never delete the account you're currently signed in as.
  const session = await getServerSession(authOptions)
  const actingEmail = session?.user?.email?.toLowerCase()
  if (actingEmail && targetEmail && actingEmail === targetEmail) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 403 })
  }

  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ success: true, message: 'Account permanently deleted' })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await adminApiGuard(); if (denied) return denied
  const { id } = await params

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        studentProfile: true,
        conversations: {
          include: {
            messages: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { updatedAt: 'desc' },
        },
        insights: { orderBy: { createdAt: 'desc' } },
        // Tree pivot: sessions are problem trees with their nodes. Explainers
        // (long markdown per node) are excluded — the admin view never renders
        // them and they balloon the payload for heavy learners.
        problemTrees: {
          include: {
            nodes: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true, parentId: true, kind: true, title: true, summary: true,
                status: true, pending: true, quizState: true, createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        files: true,
        userBadges: { orderBy: { earnedAt: 'desc' } },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // ── XP / rank summary (level + rank derive from XP, no schema) ──
    const xp = user.studentProfile?.xp ?? 0
    const level = getLevelForXp(xp)
    // "Today" in the USER's timezone — a stale dailyXp from a previous day
    // must read as 0, exactly like the learner's own goal ring.
    const userToday = userDayKey(new Date(), user.studentProfile?.timeZone ?? undefined)
    const xpSummary = {
      xp,
      level,
      rank: getRank(level),
      dailyXp: user.studentProfile?.dailyXpDay === userToday ? (user.studentProfile?.dailyXp ?? 0) : 0,
      dailyGoal: DAILY_GOAL_XP,
      streak: user.studentProfile?.streak ?? 0,
      longestStreak: user.studentProfile?.longestStreak ?? 0,
      lastCheckinDay: user.studentProfile?.lastCheckinDay ?? null,
      activeToday: user.studentProfile?.lastCheckinDay === userToday,
      timeZone: user.studentProfile?.timeZone ?? null,
    }

    // ── Badges enriched from the catalog ──
    const badges = user.userBadges.map(b => {
      const def = BADGES.find(d => d.id === b.badgeId)
      return {
        id: b.id, badgeId: b.badgeId, earnedAt: b.earnedAt, featured: b.featured,
        icon: def?.icon ?? '🏅', tier: def?.tier ?? 'bronze',
        name: def?.name.en ?? b.badgeId, nameZh: def?.name.zh ?? b.badgeId,
      }
    })

    // ── Per-tree checkpoint stats + workspace-conversation labels ──
    const nodeIndex: Record<string, { nodeTitle: string; treeId: string; treeTitle: string }> = {}
    const problemTrees = user.problemTrees.map(tree => {
      let correct = 0, attempts = 0, shortCorrect = 0, verified = 0
      for (const n of tree.nodes) {
        nodeIndex[n.id] = { nodeTitle: n.title, treeId: tree.id, treeTitle: tree.title }
        if (n.pending) continue
        const qs = parseQuizState(n.quizState)
        correct += qs.correct
        attempts += qs.attempts
        shortCorrect += qs.shortCorrect
        // Root flips green with the tree, not through checkpoints.
        if (n.status === 'understood' && n.parentId) verified++
      }
      return {
        ...tree,
        checkpointStats: { correct, attempts, shortCorrect, verified },
        hasDigest: Boolean(tree.digest),
      }
    })

    const conversations = user.conversations.map(c => {
      const m = /^tree-node:(.+)$/.exec(c.context ?? '')
      const ref = m ? nodeIndex[m[1]] : undefined
      return { ...c, workspace: ref ? { nodeId: m![1], ...ref } : null }
    })

    // ── Per-user AI usage/cost (same 90d window as the dashboard panel) ──
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const grouped = await prisma.usageEvent.groupBy({
      by: ['feature'],
      where: { userId: id, createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costUsd: true },
      _count: true,
    })
    const round = (n: number) => Math.round(n * 10000) / 10000
    let usageCost = 0, usageTokens = 0, usageEvents = 0
    const byFeature = grouped.map(g => {
      const tokens = (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0)
        + (g._sum.cacheReadTokens ?? 0) + (g._sum.cacheWriteTokens ?? 0)
      usageCost += g._sum.costUsd ?? 0
      usageTokens += tokens
      usageEvents += g._count
      return { feature: g.feature, tokens, costUsd: round(g._sum.costUsd ?? 0), events: g._count }
    }).sort((a, b) => b.costUsd - a.costUsd)
    const usage = { windowDays: 90, costUsd: round(usageCost), tokens: usageTokens, events: usageEvents, byFeature }

    return NextResponse.json({
      user: { ...user, problemTrees, conversations, badges },
      xpSummary,
      usage,
    })
  } catch (error) {
    console.error('Admin user detail API error:', error)
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }
}
