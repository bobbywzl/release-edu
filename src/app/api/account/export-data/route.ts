import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { categories, format } = body

    if (!categories || categories.length === 0) {
      return NextResponse.json({ error: 'No categories selected' }, { status: 400 })
    }

    const session = await getServerSession(authOptions)
    const userId = await getUserId()
    const store = dbStore.forUser(userId)

    // Build export data
    const exportData: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      format,
      categories,
    }

    if (categories.includes('profile')) {
      const profile = await store.getProfile()
      exportData.profile = profile ?? {
        name: session?.user?.name || 'Student',
        email: session?.user?.email || '',
      }
    }

    if (categories.includes('curriculum')) {
      exportData.curriculum = await store.getCurriculumPlan()
    }

    if (categories.includes('conversations')) {
      const convs = await store.getConversations()
      const fullConvs = []
      for (const c of convs) {
        const full = await store.getConversation(c.id)
        if (full) fullConvs.push(full)
      }
      exportData.conversations = fullConvs
    }

    if (categories.includes('projects')) {
      exportData.projects = await store.getAllProjects()
    }

    if (categories.includes('insights')) {
      exportData.insights = await store.getInsights()
    }

    if (categories.includes('activity')) {
      exportData.activity = {
        note: 'Activity log export — full implementation pending',
        exportedAt: new Date().toISOString(),
      }
    }

    const jsonStr = JSON.stringify(exportData, null, 2)
    return new Response(jsonStr, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="release-edu-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
