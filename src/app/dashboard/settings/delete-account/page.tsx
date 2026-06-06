'use client'
import { useState } from 'react'
import { ArrowLeft, AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/toast'
import Link from 'next/link'
import { signOut } from 'next-auth/react'

export default function DeleteAccountPage() {
  const toast = useToast()
  const [confirmText, setConfirmText] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [step, setStep] = useState<'info' | 'confirm'>('info')

  const confirmPhrase = 'DELETE MY ACCOUNT'
  const canDelete = confirmText === confirmPhrase && understood

  async function handleDelete() {
    if (!canDelete) return
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: confirmPhrase }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete account')
      }

      toast.success('Account deleted', 'Your account and all data have been permanently deleted.')
      // Sign out and redirect
      setTimeout(() => {
        signOut({ callbackUrl: '/login' })
      }, 1500)
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : 'Could not delete account. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <div className="p-8 lg:p-12 max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Settings
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Delete Account</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Permanently delete your account and all data</p>
          </div>
        </div>
      </div>

      <Separator />

      {step === 'info' && (
        <>
          {/* Warning */}
          <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">This action is permanent and cannot be undone</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Once you delete your account, all of your data will be permanently removed from our servers.
                  This includes your profile, conversations, projects, curriculum, and all learning history.
                </p>
              </div>
            </div>
          </div>

          {/* What gets deleted */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">What will be deleted</p>
            <div className="space-y-2">
              {[
                { label: 'Profile & Account', desc: 'Your name, email, avatar, and all account settings' },
                { label: 'Curriculum & Progress', desc: 'Your personalized curriculum, roadmap, XP, and streak data' },
                { label: 'Conversations', desc: 'All chat history with your AI mentor' },
                { label: 'Projects & Assignments', desc: 'All project data, submissions, and uploaded files' },
                { label: 'Connected Accounts', desc: 'Google, GitHub, and other linked providers' },
                { label: 'AI Insights', desc: 'All AI-generated insights about your learning patterns' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg bg-accent/30 border border-border/50">
                  <div className="w-1.5 h-1.5 rounded-full bg-destructive/60 flex-shrink-0 mt-1.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Alternatives */}
          <div className="p-4 rounded-lg bg-accent/30 border border-border/50">
            <p className="text-xs font-medium text-foreground mb-2">Before you go — consider these alternatives:</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="text-primary">→</span>
                <Link href="/dashboard/settings/export-data" className="hover:text-foreground underline">Export your data</Link> before deleting
              </li>
              <li className="flex items-center gap-2">
                <span className="text-primary">→</span>
                <Link href="/dashboard/settings/privacy" className="hover:text-foreground underline">Adjust privacy settings</Link> to control what&apos;s visible
              </li>
              <li className="flex items-center gap-2">
                <span className="text-primary">→</span>
                Take a break instead — your data will be here when you come back
              </li>
            </ul>
          </div>

          {/* Proceed button */}
          <div className="flex justify-end gap-3">
            <Link href="/dashboard/settings">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button
              variant="destructive"
              onClick={() => setStep('confirm')}
            >
              I want to delete my account
            </Button>
          </div>
        </>
      )}

      {step === 'confirm' && (
        <>
          {/* Final confirmation */}
          <div className="p-5 rounded-xl border-2 border-destructive/40 bg-destructive/5 space-y-5">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
              <p className="text-sm font-medium text-foreground">
                Final confirmation — this will permanently delete everything
              </p>
            </div>

            {/* Checkbox */}
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="mt-0.5">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={e => setUnderstood(e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-destructive"
                />
              </div>
              <span className="text-xs text-muted-foreground leading-relaxed">
                I understand that deleting my account is <strong className="text-foreground">permanent and irreversible</strong>.
                All my data, including conversations, projects, curriculum, and learning history will be permanently removed.
              </span>
            </label>

            {/* Type confirmation */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                Type <strong className="text-foreground font-mono">{confirmPhrase}</strong> to confirm
              </label>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={confirmPhrase}
                className="w-full bg-background border border-destructive/30 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-destructive/40 transition-all font-mono"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setStep('info')
                setConfirmText('')
                setUnderstood(false)
              }}
            >
              Go back
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  Permanently Delete Account
                </span>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
