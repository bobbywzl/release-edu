export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAuthorizedAdminEmail, envAdminEmails } from '@/lib/admin-auth'
import prisma from '@/lib/prisma'

// TEMP debug — surfaces what the admin email gate actually sees. Gated by the
// password cookie (middleware), not the email guard, so we can inspect.
export async function GET() {
  let sessionEmail: string | null = null
  let sessionErr: string | null = null
  try {
    const s = await getServerSession(authOptions)
    sessionEmail = s?.user?.email ?? null
  } catch (e) { sessionErr = String(e).slice(0, 200) }

  let dbRows: string[] = []
  let dbErr: string | null = null
  try {
    const rows = await prisma.adminEmail.findMany({ select: { email: true } })
    dbRows = rows.map(r => r.email)
  } catch (e) { dbErr = String(e).slice(0, 200) }

  let authorized: boolean | null = null
  let authErr: string | null = null
  try { authorized = await isAuthorizedAdminEmail(sessionEmail) } catch (e) { authErr = String(e).slice(0, 200) }

  return NextResponse.json({ sessionEmail, sessionErr, envAdmins: envAdminEmails(), dbRows, dbErr, authorized, authErr })
}
