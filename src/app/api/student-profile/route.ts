export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

interface StudentProfileMeta {
  name?: string
  organization?: string | null
  isIndividual?: boolean
  birthdate?: string
  timezone?: string
  education?: string
  occupation?: string
  mentorName?: string | null
  mentorEmail?: string | null
  parentName?: string | null
  parentEmail?: string | null
  theme?: string
  language?: 'en' | 'zh'
  languageConfirmed?: boolean
  notifications?: Record<string, boolean>
  learningPrefs?: Record<string, boolean>
}

export async function POST(req: NextRequest) {
  const body = await req.json() as StudentProfileMeta
  const userId = await getUserId()
  console.log('[student-profile POST] userId:', userId)
  const store = dbStore.forUser(userId)

  // Atomic: write displayName + roadmapState in one upsert
  const existing = await store.getProfile()
  const currentMeta = existing?.roadmapState ? JSON.parse(existing.roadmapState) : {}

  // ── Language lock ──────────────────────────────────────────────────────
  // Language is a one-time choice at onboarding. Once the user is onboarded,
  // ignore any further `language` field in incoming payloads — the stored
  // value wins. This prevents post-onboarding flips that would mismatch
  // Bob's voice with the already-generated curriculum (which was written in
  // the original language). The frontend has no UI for this either; this is
  // the server-side enforcement.
  const incomingBody = { ...body }
  if (existing?.isOnboarded && 'language' in incomingBody) {
    delete incomingBody.language
  }

  const merged = {
    ...currentMeta,
    _profileMeta: {
      ...(currentMeta._profileMeta || {}),
      ...incomingBody,
    }
  }

  const profileUpdate: Record<string, unknown> = { roadmapState: JSON.stringify(merged) }
  if (body.name?.trim()) profileUpdate.displayName = body.name.trim()

  await prisma.studentProfile.upsert({
    where: { userId },
    update: profileUpdate,
    create: { userId, ...profileUpdate },
  })

  // Update MentorConfig learning prefs if provided
  if (body.learningPrefs) {
    const prefs = body.learningPrefs
    const existingMentor = await store.getMentorConfig()
    if (existingMentor) {
      await prisma.mentorConfig.update({
        where: { id: existingMentor.id },
        data: {
          celebrateMistakes: prefs.celebrateMistakes ?? existingMentor.celebrateMistakes,
          socraticIntensity: prefs.socraticMode === false ? 3 : (prefs.socraticMode === true ? 7 : existingMentor.socraticIntensity),
          hintLevel: prefs.showHints === false ? 2 : (prefs.showHints === true ? 6 : existingMentor.hintLevel),
        }
      })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const userId = await getUserId()
  const store = dbStore.forUser(userId)
  const profile = await store.getProfile()

  let meta: Record<string, unknown> = {}
  if (profile?.roadmapState) {
    try {
      const parsed = JSON.parse(profile.roadmapState)
      meta = parsed._profileMeta || {}
    } catch { /* ignore */ }
  }

  // Always include displayName from DB directly (takes priority over _profileMeta.name)
  const sp = await prisma.studentProfile.findUnique({ where: { userId }, select: { displayName: true } })
  if (sp?.displayName) {
    meta.displayName = sp.displayName
    meta.name = sp.displayName  // also expose as 'name' so settings page input pre-fills correctly
  }

  return NextResponse.json(meta)
}
