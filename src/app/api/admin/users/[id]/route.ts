import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

// Admin actions: unlock curriculum, reset lock, force release
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (cookieStore.get('admin-auth')?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json() as { action: string }

  if (body.action === 'unlock_curriculum') {
    const updated = await prisma.curriculumPlan.updateMany({
      where: { userId: id },
      data: { lockedAt: null },
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'No curriculum plan found for this user' }, { status: 404 })
    }
    return NextResponse.json({ success: true, message: 'Curriculum unlocked' })
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        studentProfile: true,
        curriculumPlan: true,
        conversations: {
          include: {
            messages: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { updatedAt: 'desc' },
        },
        insights: { orderBy: { createdAt: 'desc' } },
        tracks: {
          include: {
            chapters: { orderBy: { order: 'asc' } },
            homeworks: true,
            quizzes: { include: { questions: true } },
            projects: { include: { tasks: true, milestones: true } },
            modules: true,
          },
        },
        files: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Admin user detail API error:', error)
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }
}
