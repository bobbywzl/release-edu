'use client'
import { useState } from 'react'
import { ArrowLeft, Eye, EyeOff, Lock, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/toast'
import Link from 'next/link'

export default function ChangePasswordPage() {
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const passwordStrength = (() => {
    if (!newPassword) return null
    let score = 0
    if (newPassword.length >= 8) score++
    if (newPassword.length >= 12) score++
    if (/[A-Z]/.test(newPassword)) score++
    if (/[0-9]/.test(newPassword)) score++
    if (/[^A-Za-z0-9]/.test(newPassword)) score++
    if (score <= 1) return { label: 'Weak', color: 'bg-red-500', width: '20%' }
    if (score <= 2) return { label: 'Fair', color: 'bg-orange-500', width: '40%' }
    if (score <= 3) return { label: 'Good', color: 'bg-yellow-500', width: '60%' }
    if (score <= 4) return { label: 'Strong', color: 'bg-green-500', width: '80%' }
    return { label: 'Very Strong', color: 'bg-emerald-400', width: '100%' }
  })()

  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword
  const canSubmit = currentPassword && newPassword.length >= 8 && passwordsMatch && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update password')
      }

      setSaved(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password updated', 'Your password has been changed successfully.')
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : 'Could not update password. Please try again.')
    } finally {
      setSaving(false)
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
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Change Password</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Update your account password</p>
          </div>
        </div>
      </div>

      <Separator />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Current password */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Current Password</label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Enter your current password"
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <Separator />

        {/* New password */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">New Password</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {/* Strength meter */}
          {passwordStrength && (
            <div className="mt-2 space-y-1">
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className={`h-full ${passwordStrength.color} rounded-full transition-all duration-300`}
                  style={{ width: passwordStrength.width }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Password strength: <span className="font-medium">{passwordStrength.label}</span>
              </p>
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Confirm New Password</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your new password"
              className={`w-full bg-background border rounded-lg px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${
                confirmPassword && !passwordsMatch ? 'border-red-500/50' : 'border-border'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmPassword && !passwordsMatch && (
            <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Passwords don&apos;t match
            </p>
          )}
          {passwordsMatch && (
            <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
              <Check className="w-3 h-3" /> Passwords match
            </p>
          )}
        </div>

        {/* Requirements */}
        <div className="p-3 rounded-lg bg-accent/30 border border-border/50">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Requirements</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {[
              { met: newPassword.length >= 8, text: 'At least 8 characters' },
              { met: /[A-Z]/.test(newPassword), text: 'One uppercase letter' },
              { met: /[0-9]/.test(newPassword), text: 'One number' },
              { met: /[^A-Za-z0-9]/.test(newPassword), text: 'One special character (recommended)' },
            ].map(req => (
              <li key={req.text} className="flex items-center gap-2">
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                  newPassword ? (req.met ? 'bg-emerald-500/20 text-emerald-400' : 'bg-border text-muted-foreground/50') : 'bg-border text-muted-foreground/30'
                }`}>
                  {newPassword && req.met ? <Check className="w-2.5 h-2.5" /> : <span className="w-1 h-1 rounded-full bg-current" />}
                </div>
                <span className={newPassword && req.met ? 'text-foreground/80' : ''}>{req.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-2">
          <Link href="/dashboard/settings">
            <Button variant="outline" type="button">Cancel</Button>
          </Link>
          <Button type="submit" disabled={!canSubmit}>
            {saving ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Updating...
              </span>
            ) : saved ? (
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4" /> Updated!
              </span>
            ) : (
              'Update Password'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
