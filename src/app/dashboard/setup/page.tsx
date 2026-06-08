'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Zap, ArrowRight, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/lib/i18n'

// value = canonical English stored to the profile; key = i18n label key.
const educationLevels = [
  { value: 'Elementary School', key: 'setup.edu.elementary' },
  { value: 'Middle School', key: 'setup.edu.middle' },
  { value: 'High School', key: 'setup.edu.high' },
  { value: 'College / University', key: 'setup.edu.college' },
  { value: 'Graduate School', key: 'setup.edu.graduate' },
  { value: 'Self-Learner', key: 'setup.edu.selfLearner' },
  { value: 'Other', key: 'setup.edu.other' },
]

const occupationOptions = [
  { value: 'Student', key: 'setup.occ.student' },
  { value: 'Working Professional', key: 'setup.occ.professional' },
  { value: 'Researcher / Academic', key: 'setup.occ.researcher' },
  { value: 'Educator / Teacher', key: 'setup.occ.educator' },
  { value: 'Engineer / Developer', key: 'setup.occ.engineer' },
  { value: 'Artist / Designer', key: 'setup.occ.artist' },
  { value: 'Entrepreneur', key: 'setup.occ.entrepreneur' },
  { value: 'Other', key: 'setup.occ.other' },
]

export default function SetupPage() {
  const router = useRouter()
  const { language, t } = useLanguage()
  const [name, setName] = useState('')

  // Redirect logic lives in dashboard/layout.tsx (single source of truth).
  const [org, setOrg] = useState('')
  const [isIndividual, setIsIndividual] = useState(false)
  const [birthdate, setBirthdate] = useState('')
  const [education, setEducation] = useState('')
  const [occupation, setOccupation] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim() && birthdate && education && occupation

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)

    // Hold the layout's redirect guard while we save + navigate, so a stale
    // useStudentData cache can't bounce us back to /dashboard/setup.
    try { sessionStorage.setItem('onboarding-completing', String(Date.now())) } catch { /* SSR safe */ }

    try {
      await fetch('/api/student-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          organization: isIndividual ? null : org.trim() || null,
          isIndividual,
          birthdate,
          education,
          occupation,
          // Persist the chosen language atomically with setup so Bob's
          // onboarding + curriculum generation use it immediately.
          language,
        }),
      })

      // Drop the cache so the next mount sees the fresh hasSetupProfile=true.
      const sd = await import('@/lib/student-data')
      sd.refreshStudentData()

      router.push('/dashboard/onboarding')
    } finally {
      // Clear the transition flag once we've kicked off navigation.
      setTimeout(() => {
        try { sessionStorage.removeItem('onboarding-completing') } catch { /* SSR safe */ }
      }, 2000)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative">
      {/* Language is chosen on the next step (the onboarding chat) — see
          LanguageChoiceModal on the onboarding page. */}
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="absolute top-6 left-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        title={t('setup.backToLogin')}
      >
        <LogOut className="w-3.5 h-3.5" />
        {t('setup.backToLogin')}
      </button>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md space-y-8"
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-foreground flex items-center justify-center">
            <Zap className="w-4 h-4 text-background" />
          </div>
          <span className="text-lg font-bold text-foreground">Release EDU</span>
        </div>

        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground">{t("setup.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('setup.quickSubtitle')}</p>
        </div>

        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('setup.fullName')}</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('setup.namePlaceholder')}
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all"
              autoFocus
            />
          </div>

          {/* Organization */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('setup.orgLabel')}</label>
            <div className="space-y-2">
              {!isIndividual && (
                <input
                  value={org}
                  onChange={e => setOrg(e.target.value)}
                  placeholder={t('setup.orgPlaceholder')}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all"
                />
              )}
              <button
                onClick={() => setIsIndividual(!isIndividual)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isIndividual ? 'bg-foreground border-foreground' : 'border-border'}`}>
                  {isIndividual && <span className="text-background text-[10px]">✓</span>}
                </div>
                {t('setup.individual')}
              </button>
            </div>
          </div>

          {/* Birthdate */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Date of Birth</label>
            <input
              type="date"
              value={birthdate}
              onChange={e => setBirthdate(e.target.value)}
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all [color-scheme:dark]"
            />
          </div>

          {/* Education Level */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('setup.eduLevel')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              {educationLevels.map(level => (
                <button
                  key={level.value}
                  onClick={() => setEducation(level.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border ${
                    education === level.value
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                  }`}
                >
                  {t(level.key)}
                </button>
              ))}
            </div>
          </div>

          {/* Occupation */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">{t('setup.describeYou')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              {occupationOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setOccupation(opt.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border ${
                    occupation === opt.value
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                  }`}
                >
                  {t(opt.key)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="w-full h-11 text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              {t('setup.settingUp')}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {t('setup.continue')}
              <ArrowRight className="w-4 h-4" />
            </span>
          )}
        </Button>

        <p className="text-[10px] text-muted-foreground text-center">
          {t('setup.footer')}
        </p>
      </motion.div>
    </div>
  )
}
