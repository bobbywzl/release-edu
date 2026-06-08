'use client'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

// "← Dashboard" back link shown on every admin sub-page (hidden on the admin
// home itself). Lets you get back to the dashboard from Conversations,
// AI Config, a user detail page, etc.
export function AdminBackLink() {
  const pathname = usePathname()
  const router = useRouter()
  if (pathname === '/admin') return null
  return (
    <button
      onClick={() => router.push('/admin')}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Dashboard
    </button>
  )
}
