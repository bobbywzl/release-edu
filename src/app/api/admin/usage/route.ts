export const dynamic = 'force-dynamic'

/**
 * DELETE /api/admin/usage — wipe all cost/usage telemetry.
 *
 * Used when the recorded history belongs to a different product era (e.g.
 * pre-Tree-pivot Release EDU spend) and the admin wants the cost panel to
 * reflect only the current app's features from a clean slate.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

export async function DELETE() {
  const denied = await adminApiGuard(); if (denied) return denied
  const result = await prisma.usageEvent.deleteMany({})
  return NextResponse.json({ ok: true, deleted: result.count })
}
