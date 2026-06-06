import { Shield } from 'lucide-react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <span className="font-semibold text-foreground text-sm">Release EDU Admin</span>
        </div>
        <a href="/admin/login?logout=true" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Sign Out
        </a>
      </header>
      <main>{children}</main>
    </div>
  )
}
