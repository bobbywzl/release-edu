import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const VALID_ROLES = ['student', 'mentor', 'admin'] as const

// Emails that are permanent owners — they can never be demoted or deleted via
// the admin UI, so an admin can't lock everyone (including the owner) out.
function ownerEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

// Admin actions: change role, unlock curriculum, reset onboarding.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (cookieStore.get('admin-auth')?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

// Permanently delete a user and ALL their data. Every User relation is
// onDelete: Cascade, so a single delete removes profile, conversations,
// curriculum, tracks, insights, files, etc. Irreversible.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (cookieStore.get('admin-auth')?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
