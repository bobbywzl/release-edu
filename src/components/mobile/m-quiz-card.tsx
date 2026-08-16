'use client'
/** The in-place checkpoint card (Bob's [[QUIZ]]): MCQ letter rows / own-words
 *  textarea / artifact capture (photo, screenshot, file — phones are where
 *  cameras live), the hypercorrection confidence tap, judge verdicts. Judged
 *  against the server-stored pending only — a 409 means the card was
 *  consumed elsewhere and the parent refetches. */
import { useRef, useState } from 'react'
import { emitXpAwards, emitBadgeEvents } from '@/components/xp-toast'
import { submitQuizAnswer, uploadNodeEvidence, sumXp, type MQuiz, type QuizVerdict } from './m-api'
import { IconCheck, IconShield, IconX } from './m-icons'

type T = (key: string, fallback?: string) => string
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

export function MQuizCard({ quiz, treeId, nodeId, lang, t, onVerdict, onStale, afterCorrect, onExplainWrong }: {
  quiz: MQuiz; treeId: string; nodeId: string; lang: string | null; t: T
  onVerdict?: (v: QuizVerdict) => void
  onStale?: () => void
  /** Post-correct CTA (e.g. Next checkpoint / Back to Today). */
  afterCorrect?: { label: string; onClick: () => void } | null
  /** Optional post-wrong CTA — remediation normally auto-fires (law). */
  onExplainWrong?: () => void
}) {
  const [sel, setSel] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [conf, setConf] = useState<'sure' | 'unsure' | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [judging, setJudging] = useState(false)
  const [verdict, setVerdict] = useState<QuizVerdict | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const isMcq = quiz.kind === 'mcq'
  const isShort = quiz.kind === 'short'
  const isArtifact = quiz.kind === 'artifact'
  const answered = !!verdict

  async function submit() {
    if (judging || answered) return
    if (isMcq && sel === null) return
    if (isShort && !text.trim()) return
    if (isArtifact && !file) return
    setJudging(true); setErrorText(null)
    let artifactFileId: string | undefined
    if (isArtifact && file) {
      // Same endpoint and shape as the desktop card — the capture lands in
      // the node's evidence list and the judge grades what it shows.
      const up = await uploadNodeEvidence(nodeId, file)
      if (!up) {
        setJudging(false)
        setErrorText(t('m.quizSubmitFailed'))
        return
      }
      artifactFileId = up.id
    }
    const v = await submitQuizAnswer({
      treeId, nodeId, quiz,
      answer: isMcq ? (sel as number) : text.trim(),
      confidence: conf, lang, artifactFileId,
    })
    setJudging(false)
    if (!v) { setErrorText(t('m.quizSubmitFailed')); return }
    if (v.stale) { onStale?.(); return }
    if (v.error) {
      // The server's message is already in the session language (e.g. the
      // artifact-unreadable re-capture guidance) — show it; clear an
      // unreadable staged file so the learner picks a better capture.
      if (v.code === 'artifact-unreadable') setFile(null)
      setErrorText(v.error || t('m.quizSubmitFailed'))
      return
    }
    setVerdict(v)
    if (v.xp?.length) emitXpAwards(v.xp)
    if (v.newBadges?.length) emitBadgeEvents(v.newBadges)
    onVerdict?.(v)
  }

  const optRow = (options: string[]) => options.slice(0, 6).map((opt, i) => {
    const isSel = sel === i
    const showTick = answered && verdict?.correctIndex === i
    const showCross = answered && isSel && verdict?.correctIndex !== i
    return (
      <div key={i}
        onClick={() => { if (!answered && !judging) setSel(i) }}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px',
          borderRadius: 8, fontSize: 14, lineHeight: 1.5, cursor: answered ? 'default' : 'pointer',
          border: showTick || isSel ? '1px solid var(--m-accent)' : '1px solid var(--m-divider)',
          background: showTick ? 'color-mix(in srgb, var(--m-accent) 10%, transparent)'
            : isSel && !answered ? 'color-mix(in srgb, var(--m-accent) 7%, transparent)' : 'var(--m-surface)',
          opacity: answered && !showTick && !isSel ? 0.55 : 1,
          color: 'var(--m-text)',
        }}>
        <span style={{ fontSize: 11, fontWeight: 600, marginTop: 3, color: isSel || showTick ? 'var(--m-accent)' : 'var(--m-neutral-500)', flex: 'none' }}>{LETTERS[i]}</span>
        <span style={{ flex: 1 }}>{opt}</span>
        {showTick && <span style={{ color: 'var(--m-accent)', display: 'inline-flex' }}><IconCheck size={14} /></span>}
        {showCross && <span style={{ color: 'var(--m-neutral-500)', display: 'inline-flex' }}><IconX size={13} /></span>}
      </div>
    )
  })

  const confPill = (on: boolean) => ({
    padding: '3px 12px', borderRadius: 99, fontSize: 11.5, cursor: 'pointer',
    border: on ? '1px solid var(--m-accent)' : '1px solid var(--m-divider)',
    color: on ? 'var(--m-accent)' : 'var(--m-neutral-400)',
    background: 'none', font: 'inherit',
  } as const)

  const correctLabel = verdict?.verified
    ? t('m.verdictVerified').replace('{xp}', String(sumXp(verdict?.xp)))
    : sumXp(verdict?.xp) > 0
      ? t('m.verdictCorrect').replace('{xp}', String(sumXp(verdict?.xp)))
      : t('m.verdictCorrectNoXp')

  const canSubmit = isMcq ? sel !== null : isShort ? !!text.trim() : !!file

  return (
    <div className="m-card m-elev-sm" style={{ gap: 12, padding: 16 }}>
      <span className="m-kicker">{t('m.checkpoint')}</span>
      <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.5, fontWeight: 500 }}>{quiz.question}</p>

      {isMcq && Array.isArray(quiz.options) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{optRow(quiz.options)}</div>
      )}
      {isShort && !answered && (
        <textarea className="m-input" style={{ minHeight: 110, fontSize: 14.5, lineHeight: 1.6 }}
          placeholder={t('m.shortPlaceholder')} value={text} maxLength={4000}
          onChange={e => setText(e.target.value)} disabled={judging} />
      )}
      {isShort && answered && (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--m-neutral-300)', borderLeft: '2px solid var(--m-divider)', paddingLeft: 12 }}>{text}</p>
      )}
      {isArtifact && !answered && (
        <>
          <input ref={fileRef} type="file" style={{ display: 'none' }}
            accept="image/*,video/*,audio/*,application/pdf,.txt,.csv,.tsv,.log,.md,.json"
            onChange={e => {
              const f = e.target.files?.[0] ?? null
              if (fileRef.current) fileRef.current.value = ''
              if (!f) return
              if (f.size > 3_500_000) { setErrorText(t('m.fileTooLarge')); return }
              setErrorText(null)
              setFile(f)
            }} />
          <button className="m-btn m-btn-secondary" style={{ alignSelf: 'flex-start', fontSize: 12.5 }}
            onClick={() => fileRef.current?.click()} disabled={judging}>
            📎 {file ? file.name.slice(0, 40) : t('m.artifactPick')}
          </button>
          <textarea className="m-input" style={{ minHeight: 64, fontSize: 13.5, lineHeight: 1.55 }}
            placeholder={t('m.artifactNote')} value={text} maxLength={400}
            onChange={e => setText(e.target.value)} disabled={judging} />
        </>
      )}
      {isArtifact && answered && (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--m-neutral-300)', borderLeft: '2px solid var(--m-divider)', paddingLeft: 12 }}>
          📎 {file?.name}{text.trim() ? ` — ${text.trim()}` : ''}
        </p>
      )}

      {!answered && (
        <>
          {quiz.hint && (
            showHint
              ? <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--m-neutral-400)', fontStyle: 'italic' }}>{quiz.hint}</p>
              : <button className="m-btn m-btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--m-neutral-500)' }} onClick={() => setShowHint(true)}>{t('m.hint')}</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--m-neutral-500)' }}>{t('m.howSure')}</span>
            <button style={confPill(conf === 'sure')} onClick={() => setConf('sure')}>{t('m.confSure')}</button>
            <button style={confPill(conf === 'unsure')} onClick={() => setConf('unsure')}>{t('m.confUnsure')}</button>
          </div>
          <button className="m-btn m-btn-primary m-btn-block" onClick={() => void submit()}
            disabled={judging || !canSubmit}>
            <IconShield size={14} />{judging ? t('common.loading') : t('m.submitAnswer')}
          </button>
          {errorText && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--m-neutral-400)' }}>{errorText}</p>}
        </>
      )}

      {answered && verdict?.correct && (
        <div style={{ borderTop: '1px solid var(--m-divider)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--m-accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconShield size={15} />{correctLabel}
          </p>
          {verdict.feedback && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--m-neutral-300)' }}>{verdict.feedback}</p>}
          {afterCorrect && (
            <button className="m-btn m-btn-secondary" style={{ fontSize: 12.5, alignSelf: 'flex-start' }} onClick={afterCorrect.onClick}>{afterCorrect.label}</button>
          )}
        </div>
      )}
      {answered && !verdict?.correct && (
        <div style={{ borderTop: '1px solid var(--m-divider)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--m-neutral-300)' }}>{t('m.verdictWrong')}</p>
          {verdict?.feedback && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--m-neutral-300)' }}>{verdict.feedback}</p>}
          {onExplainWrong && (
            <button className="m-btn m-btn-secondary" style={{ fontSize: 12.5, alignSelf: 'flex-start' }} onClick={onExplainWrong}>{t('m.explainThis')}</button>
          )}
        </div>
      )}
    </div>
  )
}
