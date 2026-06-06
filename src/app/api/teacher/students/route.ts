import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

// GET /api/teacher/students — list all students with stats
export async function GET() {
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'
  const authUserId = (session?.user as { id?: string })?.id ?? null

  // For demo/unauthenticated users, show the current user as their own student
  if (isDemo || !authUserId) {
    const userId = await getUserId()
    const store = dbStore.forUser(userId)
    const profile = await store.getProfile()
    const convs = await store.getConversations()

    const activeToday = convs.filter(c => {
      const convDate = new Date(c.updatedAt)
      return convDate.toDateString() === new Date().toDateString()
    }).length

    return NextResponse.json([{
      id: userId,
      name: profile?.userId ?? userId,
      email: userId === 'demo' ? 'demo@release.edu' : userId,
      learningStage: profile?.learningStage ?? 1,
      xp: profile?.xp ?? 0,
      streak: profile?.streak ?? 0,
      activeConversationsToday: activeToday,
      lastActive: convs[0]?.updatedAt ?? null,
      interests: profile?.interests ? JSON.parse(profile.interests) : [],
      weaknesses: profile?.weaknesses ? JSON.parse(profile.weaknesses) : [],
    }])
  }

  const students = await prisma.user.findMany({
    where: { role: 'student' },
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
