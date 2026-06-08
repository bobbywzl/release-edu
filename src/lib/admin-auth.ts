/**
 * Admin authorization — the EMAIL half of the admin gate (the password half is
 * the admin-auth cookie). A live DB check, so changes to the allow-list take
 * effect immediately (no JWT refresh / re-sign-in needed).
 *
 * An email is an authorized admin if it is:
 *   - in the ADMIN_EMAILS env bootstrap list (permanent owners), OR
 *   - in the editable AdminEmail allow-list, OR
 *   - the email of a User whose role is "admin".
 */
import prisma from '@/lib/prisma'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextResponse } from 'next/server'

export function envAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

export async function isAuthorizedAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const e = email.toLowerCase()
  if (envAdminEmails().includes(e)) return true
  try {
    const row = await prisma.adminEmail.findUnique({ where: { email: e }, select: { id: true } })
    if (row) return true
    const user = await prisma.user.findUnique({ where: { email }, select: { role: true } })
    if (user?.role === 'admin') return true
  } catch {
    /* DB unreachable — fall back to the env list result (false here) */
  }
  return false
}

/**
 * Guard for admin API routes: enforces BOTH the admin password (cookie) and a
 * live authorized-email check. Returns an error Response if not allowed, or
 * null if authorized. Usage at the top of an admin route handler:
 *   const denied = await adminApiGuard(); if (denied) return denied
 */
export async function adminApiGuard(): Promise<NextResponse | null> {
  if ((await cookies()).get('admin-auth')?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const session = await getServerSession(authOptions)
  if (!(await isAuthorizedAdminEmail(session?.user?.email))) {
    return NextResponse.json({ error: 'Forbidden — not an authorized admin email' }, { status: 403 })
  }
  return null
}
