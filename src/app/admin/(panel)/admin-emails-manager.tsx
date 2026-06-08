'use client'
import { useState, useEffect } from 'react'
import { Mail, Plus, Trash2, Loader2, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Managed { id: string; email: string; addedBy: string | null }

// Admin email allow-list manager. Lets an admin change WHO can sign into the
// admin area (the email half of the gate). Owner emails (ADMIN_EMAILS env) are
// shown but permanent; managed emails can be added/removed.
export function AdminEmailsManager() {
  const [ownerEmails, setOwnerEmails] = useState<string[]>([])
  const [managed, setManaged] = useState<Managed[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/admin/emails')
      if (!r.ok) return
      const d = await r.json()
      setOwnerEmails(d.ownerEmails || [])
      setManaged(d.managed || [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function add() {
    const email = newEmail.trim()
    if (!email) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/admin/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const d = await r.json()
      if (!r.ok) { setMsg({ kind: 'err', text: d.error || 'Failed to add' }); return }
      setNewEmail(''); setMsg({ kind: 'ok', text: d.message || `Added ${email}` }); await load()
    } catch { setMsg({ kind: 'err', text: 'Request failed' }) } finally { setBusy(false) }
  }
  async function remove(email: string) {
    if (!confirm(`Remove admin access for ${email}?`)) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/admin/emails', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const d = await r.json()
      if (!r.ok) { setMsg({ kind: 'err', text: d.error || 'Failed to remove' }); return }
      setMsg({ kind: 'ok', text: d.message || `Removed ${email}` }); await load()
    } catch { setMsg({ kind: 'err', text: 'Request failed' }) } finally { setBusy(false) }
  }

  const total = ownerEmails.length + managed.length

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center gap-2 hover:bg-accent/30 transition-colors"
      >
        <ShieldCheck className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-semibold text-foreground">Admin Access (emails)</h2>
        <span className="text-xs text-muted-foreground ml-1">{loading ? '…' : `${total} authorized`}</span>
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Admin access requires the shared password <em>and</em> signing in with one of these emails.
            Owner emails are permanent (set via the <code>ADMIN_EMAILS</code> env). Added emails take effect
            the next time that person signs in with Google.
          </p>

          {/* Owner emails (permanent) */}
          <div className="space-y-1.5">
            {ownerEmails.map(e => (
              <div key={e} className="flex items-center gap-2 text-sm">
                <Mail className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-foreground">{e}</span>
                <span className="text-[10px] text-emerald-400/80 border border-emerald-500/30 rounded px-1.5 py-0.5">owner</span>
              </div>
            ))}
            {managed.map(m => (
              <div key={m.id} className="flex items-center gap-2 text-sm group">
                <Mail className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-foreground">{m.email}</span>
                {m.addedBy && <span className="text-[10px] text-muted-foreground/60">added by {m.addedBy}</span>}
                <button
                  onClick={() => remove(m.email)}
                  disabled={busy}
                  className="ml-auto p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  title="Remove admin access"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add email */}
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder="new-admin@example.com"
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              onClick={add}
              disabled={busy || !newEmail.trim()}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add admin
            </button>
          </div>

          {msg && (
            <div className={cn('text-xs rounded-lg px-3 py-2 border',
              msg.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-300')}>
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
