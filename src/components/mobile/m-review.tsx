'use client'
/**
 * Weak-spot review overlay — the design's Review / Review-complete screens.
 * Each queue entry is a stale VERIFIED node: a [NODE_REVIEW] turn makes Bob
 * emit one review checkpoint (full XP, reviewedAt stamped by the quiz route).
 * Questions prefetch one ahead so the flow never waits twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { emitXpAwards, emitBadgeEvents } from '@/components/xp-toast'
import { streamNodeChat, submitQuizAnswer, sumXp, type MQuiz, type MReviewItem } from './m-api'
import { IconCheck, IconX } from './m-icons'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
type Outcome = { ok: boolean; xp: number } | 'skip'

export function MReview({ queue, onClose }: { queue: MReviewItem[]; onClose: () => void }) {
  const { t, language } = useLanguage()
  const [idx, setIdx] = useState(0)
  const [, setTick] = useState(0)
  const [sel, setSel] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [conf, setConf] = useState<'sure' | 'unsure' | null>(null)
  const [judging, setJudging] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; feedback: string; xp: number; correctIndex?: number } | null>(null)
  const cacheRef = useRef<Map<number, MQuiz | 'error'>>(new Map())
  const inflightRef = useRef<Set<number>>(new Set())
  const outcomesRef = useRef<Outcome[]>([])

  const ensure = useCallback((i: number) => {
    if (i >= queue.length || cacheRef.current.has(i) || inflightRef.current.has(i)) return
    inflightRef.current.add(i)
    const item = queue[i]
    void streamNodeChat({
      treeId: item.treeId, nodeId: item.nodeId, message: '[NODE_REVIEW]',
      lang: item.language ?? language,
    }).then(r => {
      cacheRef.current.set(i, r.quiz ?? 'error')
      inflightRef.current.delete(i)
      setTick(n => n + 1)
    })
  }, [queue, language])

  useEffect(() => { ensure(0); ensure(1) }, [ensure])

  const advance = useCallback((outcome: Outcome) => {
    outcomesRef.current.push(outcome)
    setSel(null); setText(''); setConf(null); setVerdict(null)
    setIdx(i => { ensure(i + 2); return i + 1 })
  }, [ensure])

  const current = idx < queue.length ? cacheRef.current.get(idx) : undefined
  const complete = queue.length === 0 || idx >= queue.length

  // A failed question load skips itself after a beat — honest, never stuck.
  useEffect(() => {
    if (current !== 'error') return
    const timer = setTimeout(() => advance('skip'), 1100)
    return () => clearTimeout(timer)
  }, [current, advance])

  const submit = useCallback(async () => {
    if (judging || verdict || !current || current === 'error') return
    const quiz = current
    if (quiz.kind === 'mcq' && sel === null) return
    if (quiz.kind !== 'mcq' && !text.trim()) return
    setJudging(true)
    const item = queue[idx]
    const v = await submitQuizAnswer({
      treeId: item.treeId, nodeId: item.nodeId, quiz,
      answer: quiz.kind === 'mcq' ? (sel as number) : text.trim(),
      confidence: conf, lang: item.language ?? language,
    })
    setJudging(false)
    if (!v || v.stale || v.error) { advance('skip'); return }
    const xp = sumXp(v.xp)
    if (v.xp?.length) emitXpAwards(v.xp)
    if (v.newBadges?.length) emitBadgeEvents(v.newBadges)
    setVerdict({ ok: v.correct, feedback: v.feedback ?? '', xp, correctIndex: v.correctIndex })
  }, [judging, verdict, current, sel, text, conf, queue, idx, language, advance])

  const outcomes = outcomesRef.current
  const answered = outcomes.filter((o): o is { ok: boolean; xp: number } => o !== 'skip')
  const correctCount = answered.filter(o => o.ok).length
  const xpTotal = answered.reduce((s, o) => s + o.xp, 0)

  const confPill = (on: boolean) => ({
    padding: '3px 12px', borderRadius: 99, fontSize: 11.5, cursor: 'pointer',
    border: on ? '1px solid var(--m-accent)' : '1px solid var(--m-divider)',
    color: on ? 'var(--m-accent)' : 'var(--m-neutral-400)', background: 'none', font: 'inherit',
  } as const)

  const dotColor = (i: number) => {
    const o = outcomes[i]
    if (o && o !== 'skip') return o.ok ? 'var(--m-accent)' : 'var(--m-neutral-600)'
    if (o === 'skip') return 'var(--m-neutral-800)'
    return i === idx && !complete ? 'var(--m-neutral-400)' : 'var(--m-neutral-800)'
  }

  const quiz = current !== 'error' ? current : undefined

  return (
    <div className="m-rise" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Header */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: 'calc(var(--m-safe-top) + 26px) 18px 12px' }}>
        <button className="m-btn m-btn-icon m-btn-secondary" style={{ width: 30, height: 30, borderRadius: 99 }} onClick={onClose}>
          <IconX size={13} />
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{t('m.reviewTitle')}</p>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--m-neutral-500)' }}>
            {complete ? t('m.reviewDoneShort') : t('m.reviewProgress').replace('{i}', String(idx + 1)).replace('{n}', String(queue.length))}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {queue.map((_, i) => (
            <span key={i} style={{ width: 18, height: 4, borderRadius: 99, background: dotColor(i) }} />
          ))}
        </div>
      </div>

      {/* Empty queue */}
      {queue.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 26, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--m-neutral-400)', maxWidth: 300 }}>{t('m.reviewEmpty')}</p>
          <button className="m-btn m-btn-primary" onClick={onClose}>{t('m.backToToday')}</button>
        </div>
      )}

      {/* Active question */}
      {!complete && queue.length > 0 && (
        <div className="m-scroll" style={{ flex: 1 }}>
          <div style={{ padding: '14px 22px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!current && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-500)' }}>{t('m.reviewLoading')}</p>
                <div className="m-skel" style={{ height: 22, width: '85%' }} />
                <div className="m-skel" style={{ height: 46 }} />
                <div className="m-skel" style={{ height: 46 }} />
              </>
            )}
            {current === 'error' && (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-400)' }}>{t('m.reviewQError')}</p>
            )}
            {quiz && (
              <>
                <p style={{ margin: 0, fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--m-accent)' }}>{queue[idx].nodeTitle}</p>
                <p style={{ margin: 0, fontSize: 18.5, lineHeight: 1.45, fontWeight: 500 }}>{quiz.question}</p>

                {quiz.kind === 'mcq' && Array.isArray(quiz.options) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {quiz.options.slice(0, 6).map((opt, i) => {
                      const isSel = sel === i
                      const showTick = !!verdict && verdict.correctIndex === i
                      const showCross = !!verdict && isSel && verdict.correctIndex !== i
                      return (
                        <div key={i} onClick={() => { if (!verdict && !judging) setSel(i) }}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px',
                            borderRadius: 8, fontSize: 14, lineHeight: 1.5, cursor: verdict ? 'default' : 'pointer',
                            border: showTick || isSel ? '1px solid var(--m-accent)' : '1px solid var(--m-divider)',
                            background: showTick ? 'color-mix(in srgb, var(--m-accent) 10%, transparent)'
                              : isSel && !verdict ? 'color-mix(in srgb, var(--m-accent) 7%, transparent)' : 'var(--m-surface)',
                            opacity: verdict && !showTick && !isSel ? 0.55 : 1,
                          }}>
                          <span style={{ fontSize: 11, fontWeight: 600, marginTop: 3, color: isSel || showTick ? 'var(--m-accent)' : 'var(--m-neutral-500)', flex: 'none' }}>{LETTERS[i]}</span>
                          <span style={{ flex: 1 }}>{opt}</span>
                          {showTick && <span style={{ color: 'var(--m-accent)', display: 'inline-flex' }}><IconCheck size={14} /></span>}
                          {showCross && <span style={{ color: 'var(--m-neutral-500)', display: 'inline-flex' }}><IconX size={13} /></span>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {quiz.kind !== 'mcq' && !verdict && (
                  <textarea className="m-input" style={{ minHeight: 110, fontSize: 14.5, lineHeight: 1.6 }}
                    placeholder={t('m.shortPlaceholder')} value={text} maxLength={4000}
                    onChange={e => setText(e.target.value)} disabled={judging} />
                )}

                {!verdict && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--m-neutral-500)' }}>{t('m.howSure')}</span>
                      <button style={confPill(conf === 'sure')} onClick={() => setConf('sure')}>{t('m.confSure')}</button>
                      <button style={confPill(conf === 'unsure')} onClick={() => setConf('unsure')}>{t('m.confUnsure')}</button>
                    </div>
                    <button className="m-btn m-btn-primary m-btn-block" onClick={() => void submit()}
                      disabled={judging || (quiz.kind === 'mcq' ? sel === null : !text.trim())}>
                      {judging ? t('common.loading') : t('m.submitAnswer')}
                    </button>
                  </>
                )}

                {verdict && (
                  <>
                    <div className="m-card m-elev-sm" style={{ gap: 8, padding: 15, borderLeft: verdict.ok ? '2px solid var(--m-accent)' : '2px solid var(--m-neutral-600)' }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: verdict.ok ? 'var(--m-accent)' : 'var(--m-neutral-300)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {verdict.ok ? <IconCheck size={15} /> : <IconX size={13} />}
                        {verdict.ok
                          ? (verdict.xp > 0 ? t('m.correctClosed').replace('{xp}', String(verdict.xp)) : t('m.correctClosedNoXp'))
                          : t('m.notQuiteRemember')}
                      </p>
                      {verdict.feedback && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--m-neutral-300)' }}>{verdict.feedback}</p>}
                    </div>
                    <button className="m-btn m-btn-primary m-btn-block"
                      onClick={() => advance({ ok: verdict.ok, xp: verdict.xp })}>
                      {idx >= queue.length - 1 ? t('m.finish') : t('m.nextQuestion')}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Complete */}
      {complete && queue.length > 0 && (
        <div className="m-scroll" style={{ flex: 1 }}>
          <div style={{ padding: '36px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center' }}>
            <span style={{ width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--m-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 24px color-mix(in srgb, var(--m-accent) 30%, transparent)', color: 'var(--m-accent)' }}>
              <IconCheck size={28} strokeWidth={1.8} />
            </span>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 22 }}>{t('m.reviewComplete')}</h4>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-400)' }}>{t('m.streakSafe')}</p>
            </div>
            <div style={{ display: 'flex', gap: 12, width: '100%' }}>
              <div className="m-card" style={{ flex: 1, gap: 2, padding: 12, alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{correctCount}/{Math.max(1, answered.length)}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: 'var(--m-neutral-500)' }}>{t('m.firstTry')}</p>
              </div>
              <div className="m-card" style={{ flex: 1, gap: 2, padding: 12, alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--m-accent)' }}>+{xpTotal}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: 'var(--m-neutral-500)' }}>{t('m.xpEarned')}</p>
              </div>
              <div className="m-card" style={{ flex: 1, gap: 2, padding: 12, alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{correctCount}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: 'var(--m-neutral-500)' }}>{t('m.holesClosed')}</p>
              </div>
            </div>
            <button className="m-btn m-btn-primary" style={{ minWidth: 180 }} onClick={onClose}>{t('m.backToToday')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
