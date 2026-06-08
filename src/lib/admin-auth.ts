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
