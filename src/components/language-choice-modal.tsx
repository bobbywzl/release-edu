'use client'
/**
 * Language-choice modal shown on the /dashboard/setup page — the very first
 * step, before the onboarding chat. Bilingual by design (a language picker must
 * be legible in every language).
 *
 * It must ONLY appear when the user is genuinely mid-onboarding: a brand-new
 * user, someone with incomplete onboarding, or someone who reset their
 * curriculum. It must NEVER appear for an already-onboarded account — which can
 * momentarily pass through the setup/onboarding flow on sign-in before the
 * layout redirects it to the dashboard. To guarantee that, the modal starts
 * HIDDEN and only reveals itself after confirming, via the server, that the
 * user is not yet onboarded.
 *
 * On confirm it sets the language and records languageConfirmed=true (a
 * deliberate-choice marker). The language is NOT locked afterwards — it can be
 * switched any time in Settings, which flips the UI and every session's
 * future Bob replies.
 */
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Languages, Check } from 'lucide-react'
import { useLanguage, type Language } from '@/lib/i18n'

export function LanguageChoiceModal({ onProceed }: { onProceed?: () => void }) {
  const { setLanguage } = useLanguage()
  // Start hidden. Reveal only once we confirm the user is not yet onboarded.
  const [show, setShow] = useState(false)
  const [pending, setPending] = useState<Language | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/student-data', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        // Already onboarded → never show. The layout is redirecting this user
        // off /onboarding; leave the modal hidden and don't unblock the chat.
        if (d && d.isOnboarded) return
        // New / incomplete / post-reset onboarding → prompt for language.
        setShow(true)
      })
      // On a fetch error, fail OPEN: a genuine onboarding user must not be
      // blocked from choosing a language. (Onboarded users won't reach here.)
      .catch(() => { if (!cancelled) setShow(true) })
    return () => { cancelled = true }
  }, [])

  function commit(lang: Language) {
    setLanguage(lang) // updates UI state + localStorage + <html lang> + persists language
    // Record the deliberate confirmation on the profile (used for the
    // post-curriculum language lock on the server).
    fetch('/api/student-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang, languageConfirmed: true }),
    }).catch(() => {})
    setShow(false)
    onProceed?.()
  }

  // Unmount the instant the choice is made. We deliberately do NOT use an
  // AnimatePresence exit animation here: commit() calls setLanguage(), which
  // re-renders the whole LanguageProvider tree, and that re-render interrupts
  // the exit animation — leaving this full-screen overlay orphaned at
  // opacity:0 with pointer-events:auto, silently swallowing every click and
  // keystroke on the onboarding page behind it. Hard-removing it is the fix.
  if (!show) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[300] bg-black/85 backdrop-blur-md flex items-center justify-center p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="bg-card border border-border rounded-2xl p-8 max-w-md w-full text-center space-y-7 shadow-2xl"
      >
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Languages className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-foreground">Choose your language</h2>
                <h2 className="text-lg font-bold text-foreground">选择你的语言</h2>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
                Bob will teach you and build your entire curriculum in the language you pick.
                <br />
                <span className="text-muted-foreground/80">Bob 将完全用你所选的语言为你授课并构建整个课程。</span>
              </p>
            </div>

            {/* Reassurance note — the choice is NOT permanent; Settings has a
                full app-wide switch. In both languages, like everything here. */}
            <div className="rounded-xl border border-border bg-muted/30 p-3.5 text-left">
              <p className="text-xs text-muted-foreground leading-relaxed">
                You can change this anytime in Settings — the app and Bob switch together.
              </p>
              <p className="text-xs text-muted-foreground/90 leading-relaxed mt-1">
                之后可随时在「设置」中更改 —— 界面和 Bob 会一起切换语言。
              </p>
            </div>

            {pending ? (
              // ── Confirmation step ──
              <div className="space-y-3">
                <p className="text-sm text-foreground font-medium">
                  Continue in <span className="text-primary font-bold">{pending === 'zh' ? '中文（简体）' : 'English'}</span>?
                  <br />
                  <span className="text-muted-foreground text-xs">确定使用{pending === 'zh' ? '中文' : 'English'}继续吗？</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setPending(null)}
                    className="rounded-xl border border-border bg-background hover:bg-accent px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-all"
                  >
                    Back · 返回
                  </button>
                  <button
                    onClick={() => commit(pending)}
                    className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    Confirm · 确认
                  </button>
                </div>
              </div>
            ) : (
              // ── Selection step ──
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => setPending('en')}
                  className="group flex items-center justify-between rounded-xl border border-border hover:border-primary/40 bg-background hover:bg-primary/5 px-5 py-4 transition-all"
                >
                  <div className="text-left">
                    <div className="text-base font-semibold text-foreground">English</div>
                    <div className="text-xs text-muted-foreground">Continue in English</div>
                  </div>
                  <Check className="w-5 h-5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <button
                  onClick={() => setPending('zh')}
                  className="group flex items-center justify-between rounded-xl border border-border hover:border-primary/40 bg-background hover:bg-primary/5 px-5 py-4 transition-all"
                >
                  <div className="text-left">
                    <div className="text-base font-semibold text-foreground">中文（简体）</div>
                    <div className="text-xs text-muted-foreground">使用中文继续</div>
                  </div>
                  <Check className="w-5 h-5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>
            )}
      </motion.div>
    </motion.div>
  )
}
