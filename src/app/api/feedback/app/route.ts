export const dynamic = 'force-dynamic'

/**
 * POST /api/feedback/app — the ever-present feedback button's target.
 *
 * One-way note from the user straight to the admin panel's Feedback page
 * (no threads/replies — that would be a support system, a separate build).
 * Context (page, tree, language, browser) rides along automatically so a
 * bug report arrives with where-it-happened attached.
 *
 * Auth: under the middleware login gate (path matches the user-API regex) —
 * getUserId() is always a real signed-in user here.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

const CATEGORIES = new Set(['bug', 'idea', 'other'])
const MAX_MESSAGE = 4000
const MAX_PER_DAY = 10

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as {
    category?: unknown; message?: unknown; page?: unknown; treeId?: unknown; lang?: unknown
  }
  const zh = body.lang === 'zh'

  const category = typeof body.category === 'string' && CATEGORIES.has(body.category) ? body.category : null
  const message = String(body.message ?? '').trim()
  if (!category || !message) {
    return NextResponse.json(
      { error: zh ? '请选择类别并写下你的反馈。' : 'Pick a category and write your note.' },
      { status: 400 },
    )
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: zh ? `反馈请控制在 ${MAX_MESSAGE} 字以内。` : `Keep it under ${MAX_MESSAGE} characters.` },
      { status: 400 },
    )
  }

  // Gentle abuse valve — a stuck retry loop or spam can't flood the admin page.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recent = await prisma.userFeedback.count({ where: { userId, createdAt: { gte: since } } }).catch(() => 0)
  if (recent >= MAX_PER_DAY) {
    return NextResponse.json(
      { error: zh ? '今天的反馈已经不少啦 — 明天再继续吧，每一条我们都会看。' : "You've sent quite a few today — more tomorrow; every note gets read." },
      { status: 429 },
    )
  }

  await prisma.userFeedback.create({
    data: {
      userId,
      category,
      message: message.slice(0, MAX_MESSAGE),
      page: typeof body.page === 'string' ? body.page.slice(0, 300) : null,
      treeId: typeof body.treeId === 'string' && body.treeId.trim() ? body.treeId.slice(0, 64) : null,
      language: zh ? 'zh' : 'en',
      userAgent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
    },
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
