import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'
import { getLevelForXp, getRank } from '@/lib/xp-engine'

export async function GET() {
  const denied = await adminApiGuard(); if (denied) return denied
  try {
    const users = await prisma.user.findMany({
      include: {
        studentProfile: true,
        conversations: {
          select: {
            id: true,
            title: true,
            updatedAt: true,
            _count: { select: { messages: true } },
          },
        },
        _count: {
          select: { conversations: true, insights: true, problemTrees: true },
        },
        // Tree pivot: each problem tree is a learning session.
        problemTrees: {
          select: {
            id: true, title: true, status: true, difficulty: true, language: true,
            nodes: { select: { status: true, pending: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      users: users.map(u => {
        const level = getLevelForXp(u.studentProfile?.xp ?? 0)
        return {
          ...u,
          level,
          rank: getRank(level),
          problemTrees: u.problemTrees.map(t => {
            const real = t.nodes.filter(n => !n.pending)
            return {
              id: t.id, title: t.title, status: t.status, difficulty: t.difficulty, language: t.language,
              nodeCount: real.length,
              understoodCount: real.filter(n => n.status === 'understood').length,
              nodes: undefined,
            }
          }),
        }
      }),
    })
  } catch (error) {
    console.error('Admin users API error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
