'use client'
/**
 * THE EVER-PRESENT FEEDBACK BUTTON — one small floating bubble on every
 * dashboard surface (canvas and workspace included), so "tell the builders"
 * is never more than one tap away. Opens a compact dialog: category chips +
 * a note → lands directly in the admin panel's Feedback page
 * (POST /api/feedback/app) with page/tree context attached automatically.
 *
 * Placement is route-aware so it never covers working controls:
 *   - normal pages: bottom-right, lifted above the mobile bottom nav;
 *   - tree canvas: bottom-right (Controls live bottom-left, hint pill
 *     bottom-center);
 *   - workspace: lifted well above the chat input dock and the collapsed-
 *     chat checkpoint pill (both own the bottom edge there).
 * The sidebar can also summon the dialog via the 'tree-edu:feedback' event.
 */
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { Bug, Check, Lightbulb, Loader2, MessageSquareHeart, MessagesSquare, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Category = 'bug' | 'idea' | 'other'

export function FeedbackButton() {
  const { t, language } = useLanguage()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<Category | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The sidebar's Feedback entry (and anything else) can summon the dialog.
  useEffect(() => {
    const summon = () => setOpen(true)
    window.addEventListener('tree-edu:feedback', summon)
    return () => window.removeEventListener('tree-edu:feedback', summon)
  }, [])

  const isCanvas = /^\/dashboard\/tree\/.+/.test(pathname ?? '')
  const isWorkspace = pathname === '/dashboard/workspace'
  const treeId = (pathname ?? '').match(/^\/dashboard\/tree\/([^/]+)/)?.[1] ?? null

  async function submit() {
    if (!category || !message.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/feedback/app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, message: message.trim(), page: pathname, treeId, lang: language }),
      })
      if (res.ok) {
        setSent(true)
        setMessage('')
        setTimeout(() => { setOpen(false) }, 1600)
      } else {
        const body = await res.json().catch(() => ({}))
        setError(typeof body?.error === 'string' && body.error ? body.error : t('feedback.failed'))
      }
    } catch {
      setError(t('feedback.failed'))
    } finally {
      setBusy(false)
    }
  }

  // Reset transient state whenever the dialog closes (kept category — the
  // next note is often the same kind).
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) { setSent(false); setError(null) }
  }

  const cats: Array<{ key: Category; icon: typeof Bug; label: string }> = [
    { key: 'bug', icon: Bug, label: t('feedback.catBug') },
    { key: 'idea', icon: Lightbulb, label: t('feedback.catIdea') },
    { key: 'other', icon: MessagesSquare, label: t('feedback.catOther') },
  ]

  return (
    <>
      {/* The bubble itself — small, translucent at rest, obvious on hover.
          z-30: above page content, below the copilot cloud (z-40) and
          dialogs (z-50), so it never covers an approval chip. */}
      <button
        onClick={() => setOpen(true)}
        title={t('feedback.button')}
        aria-label={t('feedback.button')}
        className={cn(
          'fixed z-30 flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 backdrop-blur-md shadow-lg shadow-black/20 text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-card transition-all px-3 py-2.5 opacity-80 hover:opacity-100',
          isWorkspace ? 'right-3 bottom-[8.5rem] lg:right-4 lg:bottom-32'
            : isCanvas ? 'right-4 bottom-5'
              : 'right-4 bottom-20 lg:bottom-5',
        )}
      >
        <MessageSquareHeart className="w-4 h-4 text-primary" />
        <span className="hidden sm:inline text-[11px] font-bold">{t('feedback.button')}</span>
      </button>

      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
                />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card shadow-2xl p-4"
                >
                  {sent ? (
                    <div className="py-6 flex flex-col items-center gap-2 text-center">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center">
                        <Check className="w-5 h-5 text-emerald-300" />
                      </div>
                      <p className="text-sm font-bold text-foreground">{t('feedback.sent')}</p>
                      <p className="text-xs text-muted-foreground">{t('feedback.sentSub')}</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Dialog.Title asChild>
                            <p className="text-sm font-bold text-foreground">{t('feedback.title')}</p>
                          </Dialog.Title>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{t('feedback.sub')}</p>
                        </div>
                        <Dialog.Close asChild>
                          <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label={t('common.dismiss')}>
                            <X className="w-4 h-4" />
                          </button>
                        </Dialog.Close>
                      </div>
                      <div className="flex gap-1.5 mt-3">
                        {cats.map(c => (
                          <button
                            key={c.key}
                            onClick={() => setCategory(c.key)}
                            className={cn(
                              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors',
                              category === c.key
                                ? 'border-primary/60 bg-primary/15 text-primary'
                                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                            )}
                          >
                            <c.icon className="w-3.5 h-3.5" /> {c.label}
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        rows={4}
                        maxLength={4000}
                        placeholder={t('feedback.placeholder')}
                        className="mt-2.5 w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all"
                      />
                      {error && <p className="text-[11px] text-amber-400 mt-1.5">{error}</p>}
                      <button
                        onClick={submit}
                        disabled={busy || !category || !message.trim()}
                        className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-40"
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquareHeart className="w-4 h-4" />}
                        {t('feedback.send')}
                      </button>
                    </>
                  )}
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </>
  )
}
