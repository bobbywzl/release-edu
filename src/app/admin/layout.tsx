import { Shield, Mail, LogOut } from 'lucide-react'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AdminBackLink } from './admin-back-link'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  const isAuthorizedEmail = !!email && adminEmails.includes(email.toLowerCase())

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <AdminBackLink />
          <Link href="/admin" className="flex items-center gap-2 group">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors">Release EDU Admin</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          {/* Connected admin email — green check if it's in the authorized
              ADMIN_EMAILS allow-list, amber if signed in with a non-admin email,
              muted if accessed via password only (no Google session). */}
          <span
            className="flex items-center gap-1.5 text-xs"
            title={
              email
                ? (isAuthorizedEmail
                    ? 'Signed in with an authorized admin email'
                    : 'Signed in, but this email is not in ADMIN_EMAILS')
                : 'No Google session — accessed via admin password only'
            }
          >
            <Mail className={`w-3.5 h-3.5 ${email ? (isAuthorizedEmail ? 'text-emerald-400' : 'text-amber-400') : 'text-muted-foreground/50'}`} />
            <span className={email ? (isAuthorizedEmail ? 'text-foreground' : 'text-amber-400') : 'text-muted-foreground/60'}>
              {email ?? 'password-only session'}
            </span>
          </span>
          {/* Dedicated admin sign-out — clears ONLY the admin password session
              (the admin-auth cookie). The Google account stays signed in. */}
          <a
            href="/admin/login?logout=true"
            className="flex items-center gap-1.5 text-xs font-medium text-red-400/90 hover:text-red-400 border border-red-500/30 hover:border-red-500/50 rounded-md px-2.5 py-1 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Admin sign out
          </a>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
