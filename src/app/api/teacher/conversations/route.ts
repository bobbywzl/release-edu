import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

// GET /api/teacher/conversations — every user's conversations, for the admin
// conversation browser. ADMIN-ONLY: this crosses user boundaries (titles,
// previews, names, emails), so it carries the same guard as /api/admin/*.
// (It previously ran unguarded for any signed-in user — a data leak.)
export async function GET(req: NextRequest) {
  const denied = await adminApiGuard(); if (denied) return denied

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.toLowerCase() ?? ''
  const studentId = searchParams.get('studentId')

  // No role filter: promoting a user to mentor/admin must not make their
  // conversations vanish from the browser.
  const whereClause: Record<string, unknown> = {
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
