'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Check, Camera, Loader2, Languages } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { STAGE_LABELS } from '@/lib/utils'
import { useToast } from '@/components/toast'
import { useStudentData, refreshStudentData, setDisplayName } from '@/lib/student-data'
import { useLanguage, translate, type Language } from '@/lib/i18n'
import Link from 'next/link'

export default function SettingsPage() {
  const { data, loading } = useStudentData()
  const { student } = data
  // Language IS editable here (Tree EDU): setLanguage flips the UI instantly,
  // persists the account default, and the server propagates it to every
  // ProblemTree so Bob's next reply in ANY session follows the switch.
  // (The old Release EDU one-time lock died with the generated curriculum.)
  const { t, language, setLanguage } = useLanguage()
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
    toast.info(next ? t('settings.notifOn') : t('settings.notifOff'), t(`settings.notif.${key}`))
  }

  function togglePref(key: keyof typeof learningPrefs) {
    setLearningPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // ── Language switch ──
  // setLanguage does the whole job: UI state + localStorage + <html lang> +
  // POST /api/student-profile, where the server also bulk-updates every
  // ProblemTree.language so all future Bob replies follow the switch.
  // The confirmation toast is deliberately written in the TARGET language —
  // it renders after the flip, when the whole page is already in it.
  function switchLanguage(l: Language) {
    if (l === language) return
    setLanguage(l)
    toast.success(
      translate(l, 'settings.languageSwitched'),
      translate(l, 'settings.languageSwitchedDesc'),
    )
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
          <h1 className="text-2xl font-bold text-foreground">{t('settings.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('settings.subtitle')}</p>
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

      {/* Language — the app-wide EN/中文 switch. Flips UI + menus instantly and
          every session's future Bob replies (server propagates to all trees). */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Languages className="w-3.5 h-3.5" /> {t('settings.language')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('settings.languageHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { code: 'en' as Language, title: 'English', sub: t('settings.languageEnglish') },
            { code: 'zh' as Language, title: '中文（简体）', sub: t('settings.languageChinese') },
          ]).map(opt => (
            <button
              key={opt.code}
              onClick={() => switchLanguage(opt.code)}
              aria-pressed={language === opt.code}
              className={`group flex items-center justify-between rounded-xl border px-4 py-3.5 text-left transition-all ${
                language === opt.code
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
              }`}
            >
              <div>
                <div className="text-sm font-semibold text-foreground">{opt.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{opt.sub}</div>
              </div>
              <Check className={`w-4 h-4 text-primary transition-opacity ${language === opt.code ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`} />
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{t('settings.languageNote')}</p>
      </section>

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
            <div className="text-sm text-muted-foreground">{t('common.level')} {student.level} · {STAGE_LABELS[student.stage]}</div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-primary hover:underline mt-0.5"
            >
              {t('settings.changePhoto')}
            </button>
          </div>
        </div>
        <Separator />
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('settings.displayName')}</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">
              {t('settings.email')}
              <span className="ml-2 text-[10px] text-muted-foreground/50">{t('settings.emailLinked')}</span>
            </label>
            <input
              value={email}
              readOnly
              type="email"
              className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed opacity-60"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('settings.memberSince')}</label>
            <div className="text-sm text-muted-foreground">
              {student.joinedAt
                ? new Date(student.joinedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Personal Info */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.personalInfo')}</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('settings.birthdate')}</label>
            <input
              value={birthdate}
              onChange={e => setBirthdate(e.target.value)}
              type="date"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('settings.timezone')}</label>
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
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.organization')}</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('settings.orgSchool')}</label>
            <input
              value={organization}
              onChange={e => setOrganization(e.target.value)}
              placeholder={t('settings.orgPlaceholder')}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('settings.educationLevel')}</label>
            <input
              value={education}
              onChange={e => setEducation(e.target.value)}
              placeholder={t('settings.eduPlaceholder')}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
        </div>
      </section>

      {/* Mentor & Parent */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.mentorParent')}</h2>
        <p className="text-xs text-muted-foreground">{t('settings.mentorParentDesc')}</p>

        <div className="p-4 rounded-lg border border-border space-y-3">
          <p className="text-xs font-medium text-foreground">{t('settings.mentor')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">{t('settings.name')}</label>
              <input
                value={mentorName}
                onChange={e => setMentorName(e.target.value)}
                placeholder={t('settings.mentorPlaceholder')}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">{t('settings.email')}</label>
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
            <p className="text-[10px] text-muted-foreground">{t('settings.noMentor')}</p>
          )}
        </div>

        <div className="p-4 rounded-lg border border-border space-y-3">
          <p className="text-xs font-medium text-foreground">{t('settings.parent')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">{t('settings.name')}</label>
              <input
                value={parentName}
                onChange={e => setParentName(e.target.value)}
                placeholder={t('settings.parentPlaceholder')}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">{t('settings.email')}</label>
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
            <p className="text-[10px] text-muted-foreground">{t('settings.noParent')}</p>
          )}
        </div>
      </section>




      {/* Notifications */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.notifications')}</h2>
        {([
          'streakReminders', 'weeklyProgress', 'aiSessions', 'achievements', 'projectUpdates', 'mentorMessages',
        ] as const).map((key, i) => (
          <div key={key}>
            {i > 0 && <Separator className="mb-4" />}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">{t(`settings.notif.${key}`)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t(`settings.notif.${key}Desc`)}</div>
              </div>
              <Switch checked={notifications[key]} onCheckedChange={() => toggleNotif(key)} />
            </div>
          </div>
        ))}
      </section>

      {/* Account */}
      <section className="space-y-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">{t('settings.account')}</h2>
        {[
          { key: 'password', href: '/dashboard/settings/password' },
          { key: 'connected', href: '/dashboard/settings/connected-accounts' },
          { key: 'export', href: '/dashboard/settings/export-data' },
          { key: 'privacy', href: '/dashboard/settings/privacy' },
        ].map(item => (
          <Link
            key={item.key}
            href={item.href}
            className="w-full flex items-start p-3 rounded-lg hover:bg-accent transition-colors text-left block"
          >
            <div>
              <div className="text-sm font-medium text-foreground">{t(`settings.acct.${item.key}`)}</div>
              <div className="text-xs text-muted-foreground">{t(`settings.acct.${item.key}Desc`)}</div>
            </div>
          </Link>
        ))}
        <Separator className="my-2" />
        <Link
          href="/dashboard/settings/delete-account"
          className="w-full text-left p-3 rounded-lg hover:bg-destructive/10 transition-colors block"
        >
          <div className="text-sm font-medium text-destructive">{t('settings.deleteAccount')}</div>
          <div className="text-xs text-muted-foreground">{t('settings.deleteAccountDesc')}</div>
        </Link>
      </section>

    </div>
  )
}
