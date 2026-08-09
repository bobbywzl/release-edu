export const dynamic = 'force-dynamic'

/**
 * Admin feedback inbox.
 *   GET   — newest first, with sender identity; ?status=new|seen|resolved
 *           filters, plus a count of unhandled ("new") rows for badges.
 *   PATCH — { id, status } moves one row through new → seen → resolved.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

const STATUSES = new Set(['new', 'seen', 'resolved'])

export async function GET(req: NextRequest) {
  const denied = await adminApiGuard(); if (denied) return denied
  const status = req.nextUrl.searchParams.get('status')
  const rows = await prisma.userFeedback.findMany({
    where: status && STATUSES.has(status) ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { user: { select: { email: true, name: true } } },
  })
  const newCount = await prisma.userFeedback.count({ where: { status: 'new' } })
  return NextResponse.json({
    newCount,
    rows: rows.map(r => ({
      id: r.id,
      category: r.category,
      message: r.message,
      page: r.page,
      treeId: r.treeId,
      language: r.language,
      userAgent: r.userAgent,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      userEmail: r.user?.email ?? null,
      userName: r.user?.name ?? null,
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const denied = await adminApiGuard(); if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; status?: unknown }
  const id = typeof body.id === 'string' ? body.id : null
  const status = typeof body.status === 'string' && STATUSES.has(body.status) ? body.status : null
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  const updated = await prisma.userFeedback.updateMany({ where: { id }, data: { status } })
  if (updated.count === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
