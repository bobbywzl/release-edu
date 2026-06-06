import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('demo-session-id')?.value
  const userId = sessionId ? `demo-${sessionId}` : null

  // Delete all demo user data
  if (userId) {
    try {
      await prisma.messageHighlight.deleteMany({ where: { userId } })
      await prisma.messageFeedback.deleteMany({ where: { userId } })
      await prisma.conversation.deleteMany({ where: { userId } })
      await prisma.conversationArchive.deleteMany({ where: { userId } })
      await prisma.curriculumBlock.deleteMany({ where: { userId } })
      await prisma.track.deleteMany({ where: { userId } })
      await prisma.curriculumPlan.deleteMany({ where: { userId } })
      await prisma.insight.deleteMany({ where: { userId } })
      await prisma.linkedFile.deleteMany({ where: { userId } })
      await prisma.portfolioCache.deleteMany({ where: { userId } })
      await prisma.mentorConfig.deleteMany({ where: { userId } })
      await prisma.studentProfile.deleteMany({ where: { userId } })
      await prisma.user.deleteMany({ where: { id: userId } })
    } catch (err) {
      console.error('[Demo] Cleanup failed:', err)
    }
  }

  const redirectUrl = new URL('/login', req.nextUrl.origin)
  const response = NextResponse.redirect(redirectUrl)
  response.cookies.set('demo-mode', '', { maxAge: 0, path: '/' })
  response.cookies.set('demo-session-id', '', { maxAge: 0, path: '/' })
  return response
}
