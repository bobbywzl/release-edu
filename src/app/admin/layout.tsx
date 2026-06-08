import { Shield, Mail, LogOut } from 'lucide-react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAuthorizedAdminEmail } from '@/lib/admin-auth'
import { AdminBackLink } from './admin-back-link'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-admin-pathname') || ''
  const onLoginPage = pathname.startsWith('/admin/login')

  // The login page IS the gate — render it bare (no admin header) and don't
  // enforce the email gate there (you're not signed in yet).
  if (onLoginPage) {
    return <div className="min-h-screen bg-background">{children}</div>
  }

  // LIVE email gate for every real admin page: authorized = ADMIN_EMAILS env
  // owner OR the editable AdminEmail allow-list OR a user with role "admin".
  // A live DB check, so allow-list changes take effect immediately. Unauthorized
  // → back to the admin login (never the user flow).
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null
  const authorized = await isAuthorizedAdminEmail(email)
  if (!authorized) {
    redirect('/admin/login?error=email')
  }

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
          <span className="flex items-center gap-1.5 text-xs" title="Authorized admin email">
            <Mail className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-foreground">{email ?? 'admin'}</span>
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
