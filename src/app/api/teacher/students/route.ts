import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

// GET /api/teacher/students — list all users with stats, for the admin
// conversation browser sidebar. ADMIN-ONLY: crosses user boundaries (names,
// emails, profiles). It previously ran unguarded for any signed-in user.
export async function GET() {
  const denied = await adminApiGuard(); if (denied) return denied

  const students = await prisma.user.findMany({
    include: {
      studentProfile: true,
      conversations: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { updatedAt: true },
      },
      _count: { select: { conversations: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const today = new Date()

  const result = await Promise.all(
    students.map(async student => {
      const todayConvs = await prisma.conversation.count({
        where: {
          userId: student.id,
          updatedAt: { gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()) },
        },
      })

      return {
        id: student.id,
        name: student.name,
        email: student.email,
        learningStage: student.studentProfile?.learningStage ?? 1,
        xp: student.studentProfile?.xp ?? 0,
        streak: student.studentProfile?.streak ?? 0,
        activeConversationsToday: todayConvs,
        lastActive: student.conversations[0]?.updatedAt ?? null,
        interests: JSON.parse(student.studentProfile?.interests ?? '[]'),
        weaknesses: JSON.parse(student.studentProfile?.weaknesses ?? '[]'),
      }
    })
  )

  return NextResponse.json(result)
}
