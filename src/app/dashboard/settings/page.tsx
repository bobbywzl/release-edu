'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Check, Camera, Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { STAGE_LABELS } from '@/lib/utils'
import { useToast } from '@/components/toast'
import { useStudentData, refreshStudentData, setDisplayName } from '@/lib/student-data'
import { useLanguage } from '@/lib/i18n'
import Link from 'next/link'

export default function SettingsPage() {
  const { data, loading } = useStudentData()
  const { student } = data
  // Language is intentionally NOT editable here — it's a one-time choice at
  // onboarding (setup screen + onboarding chat) so the generated curriculum,
  // insights, and Bob's voice stay in a single language for the whole run.
  // Changing it post-onboarding would create a mismatch between stored
  // Chinese content and English Bob (or vice versa).
  const { t } = useLanguage()
  const [name, setName] = useState(student.name)
  const [email, setEmail] = useState(student.email)
  const [birthdate, setBirthdate] = useState('')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [organization, setOrganization] = useState('')
  const [education, setEducation] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(student.avatar ?? null)

  // Mentor & parent info
  const [mentorName, setMentorName] = useState('')
  const [mentorEmail, setMentorEmail] = useState('')
  const [parentName, setParentName] = useState('')
  const [parentEmail, setParentEmail] = useState('')

  // Load profile data once — only after initial data load, never again
  const hasInitialized = useRef(false)
  const loadedRef = useRef(false) // true once the profile fetch settles (gates auto-save)
  useEffect(() => {
    if (loading) return // wait for data
    if (hasInitialized.current) return // already initialized
    hasInitialized.current = true
    setName(student.name)
    setEmail(student.email)
    if (student.avatar) setAvatarUrl(student.avatar)
    // Load setup profile data + displayName override
    fetch('/api/student-profile').then(r => r.json()).then(meta => {
      if (meta.displayName) setName(meta.displayName) // override with user-set name
      if (meta.birthdate) setBirthdate(meta.birthdate)
      if (meta.timezone) setTimezone(meta.timezone)
      if (meta.organization) setOrganization(meta.organization)
      if (meta.education) setEducation(meta.education)
      if (meta.mentorName) setMentorName(meta.mentorName)
      if (meta.mentorEmail) setMentorEmail(meta.mentorEmail)
      if (meta.parentName) setParentName(meta.parentName)
      if (meta.parentEmail) setParentEmail(meta.parentEmail)
      if (meta.notifications) setNotifications(prev => ({ ...prev, ...meta.notifications }))
      if (meta.learningPrefs) setLearningPrefs(prev => ({ ...prev, ...meta.learningPrefs }))
    }).catch(() => {}).finally(() => { loadedRef.current = true })
  }, [loading, student.name, student.email, student.avatar])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setAvatarUrl(url)
    toast.success('Profile photo updated')
  }
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const toast = useToast()

  const [notifications, setNotifications] = useState({
    streakReminders: true,
    weeklyProgress: true,
    aiSessions: false,
    achievements: true,
    projectUpdates: true,
    mentorMessages: true,
  })

  const [learningPrefs, setLearningPrefs] = useState({
    socraticMode: true,
    celebrateMistakes: true,
    showHints: true,
    autoSave: true,
  })

  function toggleNotif(key: keyof typeof notifications) {
    const next = !notifications[key]
    setNotifications(prev => ({ ...prev, [key]: next }))
    toast.info(next ? 'Notification enabled' : 'Notification disabled', key.replace(/([A-Z])/g, ' $1').trim())
  }

  function togglePref(key: keyof typeof learningPrefs) {
    setLearningPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // ── Auto-save ──
  // Settings persist automatically (debounced) whenever a field changes — no
  // explicit Save button. The status indicator in the header reflects state.
  const currentPayload = useCallback(() => ({
    name: name.trim(),
    organization: organization || null,
    birthdate: birthdate || null,
    timezone,
    education: education || null,
    mentorName: mentorName.trim() || null,
    mentorEmail: mentorEmail.trim() || null,
    parentName: parentName.trim() || null,
    parentEmail: parentEmail.trim() || null,
    notifications,
    learningPrefs,
  }), [name, organization, birthdate, timezone, education, mentorName, mentorEmail, parentName, parentEmail, notifications, learningPrefs])

  const lastSavedRef = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced auto-save effect. Records a baseline on the first settle after
  // load (so loading the page doesn't trigger a redundant save), then persists
  // only genuine changes.
  useEffect(() => {
    if (loading || !loadedRef.current) return
    const payload = JSON.stringify(currentPayload())
    if (lastSavedRef.current === null) { lastSavedRef.current = payload; return }
    if (payload === lastSavedRef.current) return
    setSaveStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch('/api/student-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
        if (name.trim()) setDisplayName(name.trim())
        refreshStudentData()
        lastSavedRef.current = payload
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1800)
      } catch {
        setSaveStatus('idle')
        toast.error('Failed to save', 'Please try again.')
      }
    }, 700)
  }, [currentPayload, loading, name, toast])

  return (
    <div className="p-8 lg:p-12 max-w-2xl space-y-12">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage your profile and preferences</p>
        </div>
        {/* Auto-save status — no explicit save button; changes persist automatically */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground h-9">
          {saveStatus === 'saving' ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.saving')}</>
          ) : saveStatus === 'saved' ? (
            <span className="flex items-center gap-1.5 text-green-400"><Check className="w-3.5 h-3.5" /> {t('settings.saved')}</span>
          ) : (
            <span className="text-muted-foreground/60">{t('settings.autosaveHint')}</span>
          )}
        </div>
      </div>

      {/* Profile */}
      <section className="space-y-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.profile')}</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="relative w-14 h-14 rounded-full flex-shrink-0 group"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary">
                {name[0] || student.name[0] || "?"}
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="w-4 h-4 text-white" />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </button>
          <div>
            <div className="font-medium text-foreground">{student.name}</div>
            <div className="text-sm text-muted-foreground">Level {student.level} · {STAGE_LABELS[student.stage]}</div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-primary hover:underline mt-0.5"
            >
              Change photo
            </button>
          </div>
        </div>
        <Separator />
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Display Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">
              Email
              <span className="ml-2 text-[10px] text-muted-foreground/50">(linked to Google — cannot be changed)</span>
            </label>
            <input
              value={email}
              readOnly
              type="email"
              className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed opacity-60"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Member Since</label>
            <div className="text-sm text-muted-foreground">
              {student.joinedAt
                ? new Date(student.joinedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Personal Info */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Personal Info</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Birthdate</label>
            <input
              value={birthdate}
              onChange={e => setBirthdate(e.target.value)}
              type="date"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Timezone</label>
            <input
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
        </div>
      </section>

      {/* Organization */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Organization</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">School / Organization</label>
            <input
              value={organization}
              onChange={e => setOrganization(e.target.value)}
              placeholder="e.g., Lincoln High School"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Education Level</label>
            <input
              value={education}
              onChange={e => setEducation(e.target.value)}
              placeholder="e.g., High School"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
        </div>
      </section>

      {/* Mentor & Parent */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mentor & Parent</h2>
        <p className="text-xs text-muted-foreground">Link your mentor and parent/guardian for curriculum review and progress visibility.</p>

        <div className="p-4 rounded-lg border border-border space-y-3">
          <p className="text-xs font-medium text-foreground">Mentor</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Name</label>
              <input
                value={mentorName}
                onChange={e => setMentorName(e.target.value)}
                placeholder="Mentor name"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Email</label>
              <input
                value={mentorEmail}
                onChange={e => setMentorEmail(e.target.value)}
                placeholder="mentor@email.com"
                type="email"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>
          {!mentorEmail && (
            <p className="text-[10px] text-muted-foreground">No Mentor linked yet. Your Mentor can review your curriculum and approve changes.</p>
          )}
        </div>

        <div className="p-4 rounded-lg border border-border space-y-3">
          <p className="text-xs font-medium text-foreground">Parent / Guardian</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Name</label>
              <input
                value={parentName}
                onChange={e => setParentName(e.target.value)}
                placeholder="Parent name"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Email</label>
              <input
                value={parentEmail}
                onChange={e => setParentEmail(e.target.value)}
                placeholder="parent@email.com"
                type="email"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>
          {!parentEmail && (
            <p className="text-[10px] text-muted-foreground">No parent linked yet. Parents can view your progress and receive weekly reports.</p>
          )}
        </div>
      </section>




      {/* Notifications */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notifications</h2>
        {[
          { key: 'streakReminders' as const, label: 'Streak Reminders', desc: 'Daily reminders to keep your streak alive' },
          { key: 'weeklyProgress' as const, label: 'Weekly Report', desc: 'Summary of your week every Sunday' },
          { key: 'aiSessions' as const, label: 'Session Suggestions', desc: 'Personalized prompts to start a mentor session' },
          { key: 'achievements' as const, label: 'Achievements', desc: 'Notify when you earn a new milestone' },
          { key: 'projectUpdates' as const, label: 'Project Updates', desc: 'Collaborator activity on your projects' },
          { key: 'mentorMessages' as const, label: 'Mentor Messages', desc: 'Messages from your Mentor' },
        ].map((item, i) => (
          <div key={item.key}>
            {i > 0 && <Separator className="mb-4" />}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
              </div>
              <Switch checked={notifications[item.key]} onCheckedChange={() => toggleNotif(item.key)} />
            </div>
          </div>
        ))}
      </section>

      {/* Account */}
      <section className="space-y-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Account</h2>
        {[
          { label: 'Change Password', desc: 'Update your account password', href: '/dashboard/settings/password' },
          { label: 'Connected Accounts', desc: 'Manage linked providers (Google, GitHub)', href: '/dashboard/settings/connected-accounts' },
          { label: 'Export My Data', desc: 'Download all your learning data and history', href: '/dashboard/settings/export-data' },
          { label: 'Privacy Settings', desc: 'Control what others can see about your profile', href: '/dashboard/settings/privacy' },
        ].map(item => (
          <Link
            key={item.label}
            href={item.href}
            className="w-full flex items-start p-3 rounded-lg hover:bg-accent transition-colors text-left block"
          >
            <div>
              <div className="text-sm font-medium text-foreground">{item.label}</div>
              <div className="text-xs text-muted-foreground">{item.desc}</div>
            </div>
          </Link>
        ))}
        <Separator className="my-2" />
        <Link
          href="/dashboard/settings/delete-account"
          className="w-full text-left p-3 rounded-lg hover:bg-destructive/10 transition-colors block"
        >
          <div className="text-sm font-medium text-destructive">Delete Account</div>
          <div className="text-xs text-muted-foreground">Permanently delete your account and all data</div>
        </Link>
      </section>

    </div>
  )
}
