import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'
import { DEFAULT_TEACHER_CONFIG } from '@/lib/system-prompt'

// GET /api/teacher/config
export async function GET() {
  const userId = await getUserId()
  const store = dbStore.forUser(userId)
  const config = await store.getMentorConfig()

  if (config) {
    return NextResponse.json({
      id: config.id,
      userId: config.userId,
      socraticIntensity: config.socraticIntensity,
      hintLevel: config.hintLevel,
      difficultyBias: config.difficultyBias,
      celebrateMistakes: config.celebrateMistakes,
      encourageExploration: config.encourageExploration,
      focusTopics: config.focusTopics,
      restrictedTopics: config.restrictedTopics,
      customInstructions: config.customInstructions,
      tonePreference: config.tonePreference,
      maxResponseLength: config.maxResponseLength,
      allowProjectIdeas: config.allowProjectIdeas,
      allowCareerAdvice: config.allowCareerAdvice,
    })
  }

  return NextResponse.json(DEFAULT_TEACHER_CONFIG)
}

// PATCH /api/teacher/config
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'
  const body = await req.json() as Record<string, unknown>

  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  const allowedFields = [
    'socraticIntensity', 'hintLevel', 'difficultyBias', 'celebrateMistakes',
    'encourageExploration', 'focusTopics', 'restrictedTopics', 'customInstructions',
    'tonePreference', 'maxResponseLength', 'allowProjectIdeas', 'allowCareerAdvice',
  ]

  const updateData: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in body) updateData[field] = body[field]
  }

  const config = await store.updateMentorConfig(updateData as Parameters<typeof store.updateMentorConfig>[0])
  return NextResponse.json(config)
}
