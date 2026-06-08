export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

// Manage the editable admin-email allow-list. /api/admin is already gated by the
// middleware (password + authorized email); we re-check the password cookie here
// as defence-in-depth.
function envAdmins(): string[] {
  return (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function GET() {
  const denied = await adminApiGuard(); if (denied) return denied
  const managed = await prisma.adminEmail.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({
    ownerEmails: envAdmins(), // from ADMIN_EMAILS env — permanent, not removable here
    managed: managed.map(r => ({ id: r.id, email: r.email, addedBy: r.addedBy, createdAt: r.createdAt })),
  })
}

export async function POST(req: NextRequest) {
  const denied = await adminApiGuard(); if (denied) return denied
  const { email } = (await req.json().catch(() => ({}))) as { email?: string }
  const lower = (email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(lower)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  if (envAdmins().includes(lower)) {
    return NextResponse.json({ error: 'That email is already a permanent owner (ADMIN_EMAILS).' }, { status: 400 })
  }
  const session = await getServerSession(authOptions)
  await prisma.adminEmail.upsert({
    where: { email: lower },
    update: {},
    create: { email: lower, addedBy: session?.user?.email ?? null },
  })
  return NextResponse.json({ success: true, message: `${lower} can now sign into admin (after they sign in with Google).` })
}

export async function DELETE(req: NextRequest) {
  const denied = await adminApiGuard(); if (denied) return denied
  const { email } = (await req.json().catch(() => ({}))) as { email?: string }
  const lower = (email || '').trim().toLowerCase()
  if (envAdmins().includes(lower)) {
    return NextResponse.json({ error: 'Owner emails (ADMIN_EMAILS) can’t be removed here.' }, { status: 403 })
  }
  await prisma.adminEmail.deleteMany({ where: { email: lower } })
  return NextResponse.json({ success: true, message: `Removed ${lower}.` })
}
