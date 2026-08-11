'use client'
/**
 * Reader overlay — one node, three faces (the design's Reader / Ask Bob /
 * Listening screens): the explainer as reading material, the live checkpoint
 * card, the node chat with Bob, and a speechSynthesis listen bar.
 *
 * First open of a node fires [NODE_INTRO] (the syllabus-contract turn) and
 * generates the explainer — both cached server-side afterwards.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { emitXpAwards } from '@/components/xp-toast'
import {
  fetchExplainer, fetchNodeChat, streamNodeChat, visibleProse,
  type MChatMsg, type MQuiz, type QuizVerdict,
} from './m-api'
import { MQuizCard } from './m-quiz-card'
import { IconChevronLeft, IconHeadphones, IconPause, IconSend, IconSketch } from './m-icons'
import type { ReaderTarget } from './m-shell'

const SPEEDS = [1, 1.2, 1.5, 2]

/** Markdown → plain text for the read-aloud voice. */
function toSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[[A-Z_]+\]\][^\n]*/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function MReader({ target, onClose }: { target: ReaderTarget; onClose: () => void }) {
  const { t, language } = useLanguage()
  const lang = target.language ?? language
  const [mode, setMode] = useState<'read' | 'chat'>(target.chat ? 'chat' : 'read')
  const [explainer, setExplainer] = useState<string | null>(null)
  const [explState, setExplState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [msgs, setMsgs] = useState<MChatMsg[]>([])
  const [pending, setPending] = useState<MQuiz | null>(null)
  const [mastery, setMastery] = useState(target.mastery ?? null)
  const [lastVerdict, setLastVerdict] = useState<QuizVerdict | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [soliciting, setSoliciting] = useState(false)
  const [draft, setDraft] = useState('')

  // ── Listen (speechSynthesis) ──
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [playing, setPlaying] = useState(false)
  const [listenPct, setListenPct] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)
  const posRef = useRef(0)
  const speechRef = useRef('')
  const autoplayedRef = useRef(false)

  const speakFrom = useCallback((fromChar: number, rate: number) => {
    if (!ttsSupported || !speechRef.current) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(speechRef.current.slice(fromChar))
      u.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
      u.rate = rate
      u.onboundary = e => {
        posRef.current = fromChar + (e.charIndex ?? 0)
        setListenPct(Math.min(100, posRef.current / Math.max(1, speechRef.current.length) * 100))
      }
      u.onend = () => {
        // Finished (not cancelled): reset to the top for a replay.
        if (posRef.current >= speechRef.current.length - 40) {
          posRef.current = 0
          setListenPct(0)
          setPlaying(false)
        }
      }
      window.speechSynthesis.speak(u)
    } catch { setPlaying(false) }
  }, [ttsSupported, lang])

  const togglePlay = useCallback(() => {
    if (!ttsSupported || !speechRef.current) return
    setPlaying(p => {
      if (p) { try { window.speechSynthesis.cancel() } catch { /* noop */ } return false }
      speakFrom(posRef.current, SPEEDS[speedIdx])
      return true
    })
  }, [ttsSupported, speakFrom, speedIdx])

  const cycleSpeed = useCallback(() => {
    setSpeedIdx(i => {
      const next = (i + 1) % SPEEDS.length
      if (playing) speakFrom(posRef.current, SPEEDS[next])
      return next
    })
  }, [playing, speakFrom])

  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch { /* noop */ } }, [])

  // ── Load: explainer + chat thread (intro turn on a first-ever open) ──
  const loadChat = useCallback(async () => {
    const d = await fetchNodeChat(target.treeId, target.nodeId)
    if (!d) return null
    setMsgs(d.messages)
    setPending(prev => (prev && d.pending && prev.question === d.pending.question ? prev : d.pending))
    return d
  }, [target.treeId, target.nodeId])

  useEffect(() => {
    let dead = false
    void (async () => {
      const [expl, chat] = await Promise.all([
        fetchExplainer(target.treeId, target.nodeId, lang),
        loadChat(),
      ])
      if (dead) return
      if (expl) {
        setExplainer(expl); setExplState('ok')
        speechRef.current = toSpeech(expl)
        if (target.autoplay && !autoplayedRef.current && ttsSupported) {
          autoplayedRef.current = true
          setPlaying(true)
          speakFrom(0, SPEEDS[0])
        }
      } else setExplState('failed')
      // First-ever open: fire the syllabus-contract intro turn.
      if (chat && chat.messages.length === 0) {
        setStreaming(true); setStreamText('')
        const r = await streamNodeChat({
          treeId: target.treeId, nodeId: target.nodeId, message: '[NODE_INTRO]', lang,
          onText: v => { if (!dead) setStreamText(v) },
        })
        if (dead) return
        setStreaming(false); setStreamText('')
        if (r.xp.length) emitXpAwards(r.xp)
        if (r.quiz) setPending(r.quiz)
        void loadChat()
      }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryExplainer = useCallback(async () => {
    setExplState('loading')
    const expl = await fetchExplainer(target.treeId, target.nodeId, lang)
    if (expl) { setExplainer(expl); setExplState('ok'); speechRef.current = toSpeech(expl) }
    else setExplState('failed')
  }, [target.treeId, target.nodeId, lang])

  // ── Checkpoint solicitation ([NODE_CHECKPOINT]) + remediation ──
  const solicit = useCallback(async () => {
    if (soliciting || streaming) return
    setSoliciting(true); setLastVerdict(null)
    const r = await streamNodeChat({ treeId: target.treeId, nodeId: target.nodeId, message: '[NODE_CHECKPOINT]', lang })
    if (r.xp.length) emitXpAwards(r.xp)
    if (r.quiz) setPending(r.quiz)
    else await loadChat()
    setSoliciting(false)
  }, [soliciting, streaming, target.treeId, target.nodeId, lang, loadChat])

  // ── Chat ──
  const sendTurn = useCallback(async (message: string, showUser: boolean) => {
    if (streaming) return
    if (showUser) setMsgs(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: message }])
    setStreaming(true); setStreamText('')
    const r = await streamNodeChat({
      treeId: target.treeId, nodeId: target.nodeId, message, lang,
      onText: setStreamText,
    })
    setStreaming(false); setStreamText('')
    if (r.budgetNote) {
      setMsgs(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'assistant', content: r.budgetNote as string }])
      return
    }
    if (r.prose) setMsgs(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'assistant', content: r.prose }])
    if (r.xp.length) emitXpAwards(r.xp)
    if (r.quiz) { setPending(r.quiz); setLastVerdict(null) }
    setTimeout(() => { void loadChat() }, 600)
  }, [streaming, target.treeId, target.nodeId, lang, loadChat])

  const send = useCallback(() => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    void sendTurn(text, true)
  }, [draft, streaming, sendTurn])

  // Wrong answer → the full-remediation turn, visible in the chat pane (law:
  // never a one-line correction; the next checkpoint waits until they re-engage).
  const explainWrong = useCallback(() => {
    setMode('chat')
    void sendTurn('[NODE_REMEDIATE]', false)
  }, [sendTurn])

  const onVerdict = useCallback((v: QuizVerdict) => {
    setLastVerdict(v)
    if (v.mastery) setMastery({ filled: v.mastery.correct, target: v.mastery.target })
  }, [])

  const afterCorrect = lastVerdict?.correct
    ? lastVerdict.verified || lastVerdict.alreadyVerified
      ? { label: t('m.backToToday'), onClick: onClose }
      : { label: t('m.nextCheckpoint'), onClick: () => { setPending(null); void solicit() } }
    : null

  const remainingSec = (() => {
    const cps = (lang === 'zh' ? 4.5 : 15) * SPEEDS[speedIdx]
    const left = speechRef.current.length * (1 - listenPct / 100)
    return Math.max(0, Math.round(left / Math.max(1, cps)))
  })()

  const seg = (on: boolean) => ({
    padding: '5px 13px', fontSize: 12.5, cursor: 'pointer', borderRadius: 99,
    color: on ? 'var(--m-accent)' : 'var(--m-neutral-400)',
    boxShadow: on ? 'inset 0 0 0 1px var(--m-accent)' : 'none',
  } as const)

  const masteryLabel = lastVerdict?.verified || lastVerdict?.alreadyVerified
    ? t('m.resumeVerified')
    : mastery
      ? t('m.proven').replace('{a}', String(mastery.filled)).replace('{b}', String(mastery.target))
      : null

  const quizCard = pending && (
    <MQuizCard key={pending.question} quiz={pending} treeId={target.treeId} nodeId={target.nodeId}
      lang={lang} t={t} onVerdict={onVerdict} afterCorrect={afterCorrect}
      onExplainWrong={explainWrong}
      onStale={() => { setPending(null); void loadChat() }} />
  )

  return (
    <div className="m-rise" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Header */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(var(--m-safe-top) + 26px) 16px 10px', borderBottom: '1px solid var(--m-divider)' }}>
        <button className="m-btn m-btn-ghost" style={{ padding: '4px 6px', fontSize: 13 }} onClick={onClose}>
          <IconChevronLeft size={15} />{t('m.tabToday')}
        </button>
        <div style={{ flex: 1 }} />
        <div className="m-seg" style={{ borderRadius: 99 }}>
          <span style={seg(mode === 'read')} onClick={() => setMode('read')}>{t('m.read')}</span>
          <span style={seg(mode === 'chat')} onClick={() => setMode('chat')}>{t('m.askBob')}</span>
        </div>
        {ttsSupported && (
          <button className="m-btn m-btn-icon m-btn-secondary" style={{ width: 32, height: 32, borderRadius: 99 }}
            onClick={togglePlay} title={t('m.listenMode')} disabled={explState !== 'ok'}>
            {playing
              ? <span style={{ color: 'var(--m-accent)', display: 'inline-flex' }}><IconPause size={14} /></span>
              : <IconHeadphones size={15} />}
          </button>
        )}
      </div>

      {/* Read mode */}
      {mode === 'read' && (
        <div className="m-scroll" style={{ flex: 1 }}>
          <div style={{ padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--m-accent)' }}>
                {t('m.node')} · {target.treeTitle}
              </p>
              <h3 style={{ fontSize: 23, lineHeight: 1.18 }}>{target.nodeTitle}</h3>
              {masteryLabel && <p style={{ margin: 0, fontSize: 12, color: 'var(--m-neutral-500)' }}>{masteryLabel}</p>}
            </div>

            {explState === 'loading' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="m-skel" style={{ height: 15 }} />
                <div className="m-skel" style={{ height: 15, width: '92%' }} />
                <div className="m-skel" style={{ height: 15, width: '80%' }} />
                <div style={{ border: '1px dashed var(--m-neutral-700)', borderRadius: 'var(--m-radius-md)', padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: 'var(--m-neutral-600)', display: 'inline-flex' }}><IconSketch size={20} /></span>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--m-neutral-500)', textAlign: 'center' }}>{t('m.explainerWriting')}</p>
                </div>
                <div className="m-skel" style={{ height: 15, width: '88%' }} />
              </div>
            )}
            {explState === 'failed' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-400)' }}>{t('m.explainerRetry')}</p>
                <button className="m-btn m-btn-secondary" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={() => void retryExplainer()}>{t('m.retry')}</button>
              </div>
            )}
            {explState === 'ok' && explainer && (
              <div className="m-reader-body">
                <MarkdownRenderer content={explainer} imageContext={`${target.treeTitle} — ${target.nodeTitle}`} />
              </div>
            )}

            <div className="m-hr" />

            {quizCard}
            {!pending && (soliciting
              ? <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-500)' }}>{t('m.bobThinking')}</p>
              : explState === 'ok' && !(lastVerdict?.verified || lastVerdict?.alreadyVerified) && (
                <button className="m-btn m-btn-primary m-btn-block" onClick={() => void solicit()}>{t('m.quizMe')}</button>
              ))}
          </div>
        </div>
      )}

      {/* Chat mode */}
      {mode === 'chat' && (
        <>
          <div className="m-scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
              {msgs.filter(m => m.role === 'user' || m.role === 'assistant').map(m => {
                const prose = visibleProse(m.content).trim()
                if (!prose) return null
                return m.role === 'assistant' ? (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div className="m-chat-body" style={{ maxWidth: '88%', borderRadius: '14px 14px 14px 4px', padding: '11px 14px', background: 'var(--m-surface)' }}>
                      <MarkdownRenderer content={prose} />
                    </div>
                  </div>
                ) : (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div className="m-chat-body" style={{ maxWidth: '82%', borderRadius: '14px 14px 4px 14px', padding: '11px 14px', background: 'var(--m-accent-900)', border: '1px solid var(--m-accent-800)' }}>
                      {prose}
                    </div>
                  </div>
                )
              })}
              {streaming && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  {streamText.trim() ? (
                    <div className="m-chat-body" style={{ maxWidth: '88%', borderRadius: '14px 14px 14px 4px', padding: '11px 14px', background: 'var(--m-surface)' }}>
                      <MarkdownRenderer content={streamText} />
                    </div>
                  ) : (
                    <div style={{ borderRadius: 14, padding: '11px 16px', background: 'var(--m-surface)', fontSize: 14, color: 'var(--m-neutral-500)' }}>
                      {t('m.bobThinking')}
                    </div>
                  )}
                </div>
              )}
              {!streaming && quizCard}
            </div>
          </div>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px calc(var(--m-safe-bottom) + 14px)', borderTop: '1px solid var(--m-divider)' }}>
            <input className="m-input" style={{ flex: 1, borderRadius: 99, padding: '8px 16px', minHeight: 40 }}
              placeholder={t('m.chatPlaceholder')} value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }} />
            <button className="m-btn m-btn-icon m-btn-primary" style={{ borderRadius: 99, width: 40, height: 40, flex: 'none' }}
              onClick={send} disabled={streaming || !draft.trim()}>
              <IconSend size={16} />
            </button>
          </div>
        </>
      )}

      {/* Listen bar */}
      {playing && (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px calc(var(--m-safe-bottom) + 10px)', borderTop: '1px solid var(--m-divider)', background: 'color-mix(in srgb, var(--m-bg) 90%, black)' }}>
          <button className="m-btn m-btn-icon m-btn-primary" style={{ borderRadius: 99, width: 36, height: 36, flex: 'none' }} onClick={togglePlay}>
            <IconPause size={13} />
          </button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--m-neutral-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t('m.listeningTo').replace('{title}', target.nodeTitle)}
            </p>
            <div className="m-bar"><div style={{ width: `${listenPct}%`, transition: 'none' }} /></div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--m-neutral-500)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
            -{Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, '0')}
          </span>
          <button className="m-btn m-btn-secondary" style={{ fontSize: 11.5, padding: '3px 9px', flex: 'none', borderRadius: 99 }} onClick={cycleSpeed}>
            {SPEEDS[speedIdx]}×
          </button>
        </div>
      )}
    </div>
  )
}
