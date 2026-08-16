'use client'
/**
 * THE ANSWER, on the phone (qa-findings-4 №2): a completed tree's payoff —
 * the resolution document assembled from the learner's proven nodes — used
 * to be desktop-only; the completed card on /m was a dead end. Read-only:
 * a plain text fetch of the cached document, no AI call. Generation stays on
 * the desktop tree page (budget-gated there).
 */
import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { fetchTreeAnswer } from './m-api'
import { IconChevronLeft } from './m-icons'

export function MAnswer({ treeId, treeTitle, onClose }: {
  treeId: string; treeTitle: string; onClose: () => void
}) {
  const { t } = useLanguage()
  const [state, setState] = useState<'loading' | 'ok' | 'empty'>('loading')
  const [answer, setAnswer] = useState<string | null>(null)

  useEffect(() => {
    let dead = false
    void fetchTreeAnswer(treeId).then(d => {
      if (dead) return
      if (d?.answer?.trim()) { setAnswer(d.answer); setState('ok') }
      else setState('empty')
    })
    return () => { dead = true }
  }, [treeId])

  return (
    <div className="m-rise" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(var(--m-safe-top) + 26px) 16px 10px', borderBottom: '1px solid var(--m-divider)' }}>
        <button className="m-btn m-btn-ghost" style={{ padding: '4px 6px', fontSize: 13 }} onClick={onClose}>
          <IconChevronLeft size={15} />{t('m.tabTrees')}
        </button>
        <div style={{ flex: 1 }} />
      </div>
      <div className="m-scroll" style={{ flex: 1 }}>
        <div style={{ padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--m-accent)' }}>{t('m.theAnswer')}</p>
            <h3 style={{ fontSize: 22, lineHeight: 1.2 }}>{treeTitle}</h3>
          </div>
          {state === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-500)' }}>{t('m.answerLoading')}</p>
              <div className="m-skel" style={{ height: 15 }} />
              <div className="m-skel" style={{ height: 15, width: '90%' }} />
              <div className="m-skel" style={{ height: 15, width: '82%' }} />
            </div>
          )}
          {state === 'empty' && (
            <p style={{ margin: 0, padding: 18, border: '1px dashed var(--m-neutral-700)', borderRadius: 'var(--m-radius-md)', fontSize: 13, lineHeight: 1.6, color: 'var(--m-neutral-400)' }}>
              {t('m.answerNone')}
            </p>
          )}
          {state === 'ok' && answer && (
            <div className="m-reader-body">
              <MarkdownRenderer content={answer} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
