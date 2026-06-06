import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

// GET /api/teacher/conversations — all conversations for teacher's students
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'
  const authUserId = (session?.user as { id?: string })?.id ?? null

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.toLowerCase() ?? ''
  const studentId = searchParams.get('studentId')

  if (isDemo || !authUserId) {
    const userId = await getUserId()
    const store = dbStore.forUser(userId)
    let convs = await store.getConversations()

    if (search) {
      convs = convs.filter(c =>
        c.title.toLowerCase().includes(search) ||
        c.context?.toLowerCase().includes(search) ||
        c.messages.some(m => m.content.toLowerCase().includes(search))
      )
    }

    return NextResponse.json(
      convs.map(c => ({
        id: c.id,
        title: c.title,
        context: c.context,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c._count.messages,
        studentId: userId,
        studentName: userId,
        studentEmail: userId === 'demo' ? 'demo@release.edu' : userId,
        preview: c.messages[0]?.content?.slice(0, 100) ?? '',
      }))
    )
  }

  const whereClause: Record<string, unknown> = {
    user: { role: 'student' },
    ...(studentId && { userId: studentId }),
  }

  const conversations = await prisma.conversation.findMany({
    where: whereClause,
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      user: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true },
      },
      _count: { select: { messages: true } },
    },
  })

  let result = conversations.map(c => ({
    id: c.id,
    title: c.title,
    context: c.context,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c._count.messages,
    studentId: c.user.id,
    studentName: c.user.name,
    studentEmail: c.user.email,
    preview: c.messages[0]?.content?.slice(0, 100) ?? '',
  }))

  if (search) {
    result = result.filter(c =>
      c.title.toLowerCase().includes(search) ||
      c.context?.toLowerCase().includes(search) ||
      c.preview.toLowerCase().includes(search) ||
      c.studentName?.toLowerCase().includes(search)
    )
  }

  return NextResponse.json(result)
}
