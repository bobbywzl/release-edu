import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'
import type { CurriculumModule, ContentChapter, Homework, Quiz } from '@/types'

type CurriculumAction =
  | { type: 'create_module'; data: Partial<CurriculumModule> }
  | { type: 'update_module'; moduleId: string; data: Partial<CurriculumModule> }
  | { type: 'update_profile'; data: { learningStyle?: string; strengths?: string[]; weaknesses?: string[]; interests?: string[]; aspirations?: string } }
  | { type: 'suggest_change'; description: string; modules?: Partial<CurriculumModule>[] }
  | { type: 'lock_in' }
  | { type: 'update_syllabus'; trackId: string; data: { title?: string; description?: string; chapters?: Partial<ContentChapter>[] } }
  | { type: 'add_chapter'; trackId: string; data: Partial<ContentChapter> }
  | { type: 'update_chapter'; trackId: string; chapterId: string; data: Partial<ContentChapter> }
  | { type: 'update_homework'; trackId: string; homeworkId: string; data: Partial<Homework> }
  | { type: 'add_homework'; trackId: string; data: Partial<Homework> }
  | { type: 'update_project_approval'; trackId: string; status: 'approved' | 'needs-revision'; feedback?: string }
  | { type: 'add_quiz'; trackId: string; data: Partial<Quiz> }

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'
  const session = await getServerSession(authOptions)

  if (!session?.user && !isDemo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (isDemo) {
    return NextResponse.json({ success: true, demo: true })
  }

  const action = await req.json() as CurriculumAction

  if (!action?.type) {
    return NextResponse.json({ error: 'Action type required' }, { status: 400 })
  }

  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  // Check curriculum lock for modification actions
  const modifyActions = ['update_module', 'create_module', 'update_syllabus', 'add_chapter', 'update_chapter', 'update_homework', 'add_homework', 'update_project_approval', 'add_quiz']
  if (modifyActions.includes(action.type)) {
    const prisma = (await import('@/lib/prisma')).default
    const plan = await prisma.curriculumPlan.findFirst({ where: { userId }, select: { lockedAt: true, generatedAt: true } })
    if (plan?.lockedAt) {
      const lockEnd = new Date(plan.lockedAt)
      lockEnd.setDate(lockEnd.getDate() + 30)
      if (new Date() < lockEnd) {
        return NextResponse.json({ error: 'Curriculum is locked. Changes are not allowed during the lock period.', lockedUntil: lockEnd.toISOString() }, { status: 403 })
      }
    }
  }

  switch (action.type) {
    case 'update_module': {
      const updated = await store.updateCurriculumModule(action.moduleId, action.data)
      return NextResponse.json({ success: true, updated, message: 'Module updated' })
    }

    case 'create_module': {
      // For create_module, we'd need to add to an existing track
      // For now, acknowledge
      return NextResponse.json({ success: true, message: 'Module creation noted' })
    }

    case 'update_profile': {
      if (action.data.learningStyle) {
        await store.updateProfile({ learningStyle: action.data.learningStyle })
      }
      if (action.data.strengths) {
        await store.updateProfile({ strengths: JSON.stringify(action.data.strengths) })
      }
      if (action.data.weaknesses) {
        await store.updateProfile({ weaknesses: JSON.stringify(action.data.weaknesses) })
      }
      if (action.data.interests) {
        await store.updateProfile({ interests: JSON.stringify(action.data.interests) })
      }
      if (action.data.aspirations) {
        await store.updateProfile({ aspirations: action.data.aspirations })
      }
      return NextResponse.json({ success: true, message: 'Profile updated' })
    }

    case 'lock_in': {
      // Just update the lockedAt field directly — no need to recreate tracks
      const prisma = (await import('@/lib/prisma')).default
      const updated = await prisma.curriculumPlan.updateMany({
        where: { userId },
        data: { lockedAt: new Date() },
      })
      if (updated.count === 0) {
        return NextResponse.json({ error: 'No curriculum plan exists' }, { status: 404 })
      }
      return NextResponse.json({ success: true, lockedAt: new Date().toISOString(), message: 'Curriculum locked in' })
    }

    case 'suggest_change': {
      await store.addInsight({
        type: 'preference',
        content: `Bob suggested: ${action.description}`,
        confidence: 0.8,
        source: 'chat-curriculum-suggestion',
      })
      return NextResponse.json({ success: true, queued: true, message: 'Change suggestion noted for next review window' })
    }

    case 'update_syllabus': {
      const updated = await store.updateSyllabus(action.trackId, action.data)
      if (!updated) {
        return NextResponse.json({ error: 'Syllabus not found for track' }, { status: 404 })
      }
      return NextResponse.json({ success: true, syllabus: updated, message: 'Syllabus updated' })
    }

    case 'add_chapter': {
      const chapter = await store.addChapter(action.trackId, action.data)
      if (!chapter) {
        return NextResponse.json({ error: 'Syllabus not found for track' }, { status: 404 })
      }
      return NextResponse.json({ success: true, chapter, message: 'Chapter added' })
    }

    case 'update_chapter': {
      const chapter = await store.updateChapter(action.trackId, action.chapterId, action.data)
      if (!chapter) {
        return NextResponse.json({ error: 'Chapter not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true, chapter, message: 'Chapter updated' })
    }

    case 'update_homework': {
      const hw = await store.updateHomework(action.trackId, action.homeworkId, action.data)
      if (!hw) {
        return NextResponse.json({ error: 'Homework not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true, homework: hw, message: 'Homework updated' })
    }

    case 'add_homework': {
      const hw = await store.addHomework(action.trackId, action.data)
      return NextResponse.json({ success: true, homework: hw, message: 'Homework added' })
    }

    case 'update_project_approval': {
      const project = await store.updateProjectApproval(action.trackId, action.status, action.feedback)
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true, project, message: `Project ${action.status === 'approved' ? 'approved' : 'sent back for revision'}` })
    }

    case 'add_quiz': {
      const quiz = await store.addQuiz(action.trackId, action.data as Parameters<typeof store.addQuiz>[1])
      return NextResponse.json({ success: true, quiz, message: 'Quiz added' })
    }

    default:
      return NextResponse.json({ error: 'Unknown action type' }, { status: 400 })
  }
}
