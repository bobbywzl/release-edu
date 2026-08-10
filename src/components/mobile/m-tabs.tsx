'use client'
/** The three tab panes + bottom tab bar, faithful to the design's Today /
 *  Trees screens; Notes is the added full-notes directory (user request). */
import type { MobileData, MNote, XpSummary } from './m-api'
import type { ReaderTarget } from './m-shell'
import {
  IconFlame, IconToday, IconTree, IconReview, IconNotes, IconHeadphones,
  IconChevronRight, IconCheck, IconShield,
} from './m-icons'

type T = (key: string, fallback?: string) => string

const goDesktop = () => {
  try { localStorage.setItem('tree-mobile-optout', '1') } catch { /* still navigate */ }
  window.location.href = '/dashboard'
}

/* ── Today ── */

export function TodayTab({ data, xp, name, t, uiLang, onOpenReader, onStartReview }: {
  data: MobileData; xp: XpSummary | null; name: string; t: T; uiLang: string
  onOpenReader: (target: ReaderTarget) => void
  onStartReview: () => void
}) {
  const now = new Date()
  const hour = now.getHours()
  const greet = hour < 12 ? t('m.greetMorning') : hour < 18 ? t('m.greetAfternoon') : t('m.greetEvening')
  const dateLine = new Intl.DateTimeFormat(uiLang === 'zh' ? 'zh-CN' : 'en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(now)
  const goal = xp?.dailyGoal ?? 200
  const today = xp?.xpToday ?? 0
  const ringOffset = 125.7 * (1 - Math.min(1, goal > 0 ? today / goal : 0))
  const { resume, reviewQueue } = data
  const reviewCount = reviewQueue.length
  const showReviewRow = reviewCount > 0 || data.stats.understoodNodes > 0
  const openResume = (autoplay?: boolean) => {
    if (!resume) return
    onOpenReader({
      treeId: resume.treeId, nodeId: resume.nodeId, nodeTitle: resume.nodeTitle,
      treeTitle: resume.treeTitle, language: resume.language, autoplay,
      mastery: { filled: resume.filled, target: resume.target },
    })
  }
  let planNo = 0
  const planCircle = (done: boolean) => done ? (
    <span style={{ width: 26, height: 26, flex: 'none', borderRadius: '50%', border: '1px solid var(--m-accent)', color: 'var(--m-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <IconCheck size={13} />
    </span>
  ) : (
    <span style={{ width: 26, height: 26, flex: 'none', borderRadius: '50%', border: '1px solid var(--m-neutral-700)', color: 'var(--m-neutral-400)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
      {++planNo}
    </span>
  )
  const planRow = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 'var(--m-radius-md)', background: 'var(--m-surface)' } as const
  const planTitle = { margin: 0, flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 500, lineHeight: 1.3 } as const

  return (
    <div style={{ padding: 'calc(var(--m-safe-top) + 44px) 22px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ margin: '0 0 3px', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--m-neutral-500)' }}>{dateLine}</p>
          <h4 style={{ fontSize: 24 }}>{greet}{name ? (uiLang === 'zh' ? `，${name}` : `, ${name}`) : ''}</h4>
        </div>
        <div style={{ position: 'relative', width: 48, height: 48, flex: 'none' }} title={t('m.dailyGoalTitle')}>
          <svg width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--m-neutral-900)" strokeWidth="4.5" />
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--m-accent)" strokeWidth="4.5" strokeLinecap="round"
              strokeDasharray="125.7" strokeDashoffset={ringOffset}
              style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.16,1,.3,1)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{today}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12.5, color: 'var(--m-neutral-400)' }}>
        {(xp?.streak ?? 0) > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: 'var(--m-accent)', display: 'inline-flex' }}><IconFlame size={14} /></span>
            {t('m.streakDays').replace('{n}', String(xp?.streak ?? 0))}
          </span>
        )}
        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{today}/{goal} XP</span>
        {today >= goal && <span style={{ color: 'var(--m-accent)' }}>{t('m.goalMet')}</span>}
      </div>

      {data.trees.length === 0 && (
        <div className="m-card m-elev-sm" style={{ gap: 10, padding: 16 }}>
          <span className="m-kicker">Tree EDU</span>
          <p className="m-card-title" style={{ margin: 0, fontSize: 18, lineHeight: 1.25 }}>{t('m.emptyTitle')}</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--m-neutral-400)' }}>{t('m.emptyBody')}</p>
          <button className="m-btn m-btn-primary" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={goDesktop}>{t('m.openDesktop')}</button>
        </div>
      )}

      {resume && (
        <div className="m-card m-elev-sm" style={{ gap: 10, padding: 16, cursor: 'pointer' }} onClick={() => openResume()}>
          <span className="m-kicker">{t('m.resumeContinue')}</span>
          <p className="m-card-title" style={{ margin: 0, fontSize: 18, lineHeight: 1.25 }}>{resume.nodeTitle}</p>
          <div className="m-bar" style={{ marginTop: 2 }}>
            <div style={{ width: `${Math.round(resume.filled / Math.max(1, resume.target) * 100)}%` }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--m-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>
              {t('m.proven').replace('{a}', String(resume.filled)).replace('{b}', String(resume.target))}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="m-btn m-btn-secondary" style={{ fontSize: 12.5, padding: '5px 10px' }}
                onClick={e => { e.stopPropagation(); openResume(true) }}>
                <IconHeadphones size={14} />{t('m.listen')}
              </button>
              <button className="m-btn m-btn-primary" style={{ fontSize: 12.5, padding: '5px 12px' }}
                onClick={e => { e.stopPropagation(); openResume() }}>
                {t('m.resumeContinue')}<IconChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {(showReviewRow || resume) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h6 style={{ fontSize: 11, color: 'var(--m-neutral-400)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{t('m.planTitle')}</h6>

          {showReviewRow && (
            <div style={{ ...planRow, cursor: reviewCount > 0 ? 'pointer' : 'default' }}
              onClick={() => { if (reviewCount > 0) onStartReview() }}>
              {planCircle(reviewCount === 0)}
              <p style={planTitle}>
                {reviewCount === 0 ? t('m.planReviewDone')
                  : reviewCount === 1 ? t('m.planReviewOne')
                  : t('m.planReview').replace('{n}', String(reviewCount))}
              </p>
              {reviewCount > 0 && <span style={{ color: 'var(--m-neutral-600)', display: 'inline-flex' }}><IconChevronRight size={14} /></span>}
            </div>
          )}

          {resume && (
            <div style={{ ...planRow, cursor: 'pointer' }} onClick={() => openResume()}>
              {planCircle(false)}
              <p style={planTitle}>{t('m.planFinishNodeLeft').replace('{n}', String(Math.max(1, resume.target - resume.filled)))}</p>
              <span style={{ color: 'var(--m-neutral-600)', display: 'inline-flex' }}><IconChevronRight size={14} /></span>
            </div>
          )}
          {!resume && data.stats.totalNodes > 0 && (
            <div style={planRow}>
              {planCircle(true)}
              <p style={planTitle}>{t('m.planNodeDone')}</p>
            </div>
          )}

          {resume && (
            <div style={{ ...planRow, cursor: 'pointer' }} onClick={() => openResume(true)}>
              {planCircle(false)}
              <p style={planTitle}>{t('m.planListenNext')}</p>
              <span style={{ color: 'var(--m-neutral-600)', display: 'inline-flex' }}><IconHeadphones size={15} /></span>
            </div>
          )}
        </div>
      )}

      {reviewCount > 0 && (
        <p style={{ margin: 0, padding: '12px 14px', borderRadius: 'var(--m-radius-md)', border: '1px solid var(--m-divider)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--m-neutral-400)' }}>
          {t('m.awayNote').replace('{n}', String(reviewCount))}
        </p>
      )}
    </div>
  )
}

/* ── Trees ── */

export function TreesTab({ data, t, onOpenReader }: {
  data: MobileData; t: T
  onOpenReader: (target: ReaderTarget) => void
}) {
  const active = data.trees.filter(tr => tr.status === 'active')
  const completed = data.trees.filter(tr => tr.status === 'completed')
  return (
    <div style={{ padding: 'calc(var(--m-safe-top) + 44px) 22px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h4 style={{ fontSize: 24 }}>{t('m.yourTrees')}</h4>
      <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--m-neutral-400)' }}>
        <span><strong style={{ fontWeight: 600, color: 'var(--m-text)', fontSize: 15 }}>{data.stats.active}</strong> {t('m.statActive')}</span>
        <span><strong style={{ fontWeight: 600, color: 'var(--m-text)', fontSize: 15 }}>{data.stats.understoodNodes}</strong>/{data.stats.totalNodes} {t('m.statNodes')}</span>
        <span><strong style={{ fontWeight: 600, color: 'var(--m-accent)', fontSize: 15 }}>{data.stats.mastered}</strong> {t('m.statMastered')}</span>
      </div>

      {active.map(tr => {
        const pct = tr.nodeCount > 0 ? Math.round(tr.understoodCount / tr.nodeCount * 100) : 0
        const clickable = !!tr.resumeNodeId
        return (
          <div key={tr.id} className="m-card" style={{ gap: 9, padding: 15, cursor: clickable ? 'pointer' : 'default' }}
            onClick={() => {
              if (!tr.resumeNodeId) return
              onOpenReader({
                treeId: tr.id, nodeId: tr.resumeNodeId, nodeTitle: tr.resumeNodeTitle ?? '',
                treeTitle: tr.title, language: tr.language, mastery: null,
              })
            }}>
            <p className="m-card-title" style={{ margin: 0, fontSize: 16, lineHeight: 1.3 }}>{tr.title}</p>
            <div className="m-bar"><div style={{ width: `${pct}%`, ...(tr.accentColor ? { background: tr.accentColor } : {}) }} /></div>
            <div className="m-card-meta" style={{ justifyContent: 'space-between' }}>
              <span>{tr.understoodCount}/{tr.nodeCount} {t('m.statNodes')}</span>
              {tr.reviewDue > 0
                ? <span className="m-tag m-tag-accent" style={{ fontSize: 10, padding: '2px 8px' }}>{t('m.reviewDue').replace('{n}', String(tr.reviewDue))}</span>
                : clickable ? <span style={{ color: 'var(--m-accent)' }}>{t('m.treeContinue')}</span> : null}
            </div>
          </div>
        )
      })}

      {completed.map(tr => (
        <div key={tr.id} className="m-card" style={{ gap: 6, padding: 15, border: '1px solid var(--m-accent-800)', background: 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--m-accent)', display: 'inline-flex' }}><IconShield size={16} /></span>
            <p className="m-card-title" style={{ margin: 0, fontSize: 15, lineHeight: 1.3, flex: 1 }}>{tr.title}</p>
          </div>
          <div className="m-card-meta"><span className="m-tag m-tag-outline" style={{ fontSize: 10, padding: '2px 8px' }}>{t('m.masteredTag')}</span></div>
        </div>
      ))}

      <button onClick={goDesktop} className="m-btn m-btn-ghost"
        style={{ alignSelf: 'center', fontSize: 12, color: 'var(--m-neutral-500)', marginTop: 6 }}>
        {t('m.desktopSite')}
      </button>
    </div>
  )
}

/* ── Notes (full notes page + directory — user request) ── */

export function NotesTab({ data, t, uiLang, onOpenNote }: {
  data: MobileData; t: T; uiLang: string
  onOpenNote: (n: MNote) => void
}) {
  const fmt = new Intl.DateTimeFormat(uiLang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
  return (
    <div style={{ padding: 'calc(var(--m-safe-top) + 44px) 22px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h4 style={{ fontSize: 24 }}>{t('m.notesTitle')}</h4>
      {data.notes.length === 0 && (
        <p style={{ margin: 0, padding: 18, border: '1px dashed var(--m-neutral-700)', borderRadius: 'var(--m-radius-md)', fontSize: 13, lineHeight: 1.55, color: 'var(--m-neutral-500)', textAlign: 'center' }}>
          {t('m.notesEmpty')}
        </p>
      )}
      {data.notes.map(n => (
        <div key={n.nodeId} className="m-card" style={{ gap: 6, padding: '12px 14px', cursor: 'pointer' }} onClick={() => onOpenNote(n)}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, lineHeight: 1.3 }}>{n.nodeTitle}</p>
          <p style={{
            margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--m-neutral-400)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{n.text}</p>
          <div className="m-card-meta" style={{ justifyContent: 'space-between' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.treeTitle}</span>
            <span style={{ flex: 'none' }}>{fmt.format(new Date(n.updatedAt))}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Bottom tab bar ── */

export function TabBar({ tab, t, reviewDot, onTab, onReview }: {
  tab: 'today' | 'trees' | 'notes'; t: T; reviewDot: boolean
  onTab: (tab: 'today' | 'trees' | 'notes') => void
  onReview: () => void
}) {
  const item = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', minHeight: 44, cursor: 'pointer', position: 'relative', background: 'none', border: 'none', font: 'inherit' } as const
  const iconStyle = (on: boolean) => ({ color: on ? 'var(--m-accent)' : 'var(--m-neutral-600)', display: 'inline-flex' })
  const labelStyle = (on: boolean) => ({ fontSize: 10, fontWeight: 500, letterSpacing: '.02em', color: on ? 'var(--m-accent)' : 'var(--m-neutral-600)' } as const)
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex',
      borderTop: '1px solid var(--m-divider)',
      background: 'color-mix(in srgb, var(--m-bg) 92%, black)',
      padding: '6px 10px calc(var(--m-safe-bottom) + 6px)',
    }}>
      <button style={item} onClick={() => onTab('today')}>
        <span style={iconStyle(tab === 'today')}><IconToday size={21} /></span>
        <span style={labelStyle(tab === 'today')}>{t('m.tabToday')}</span>
      </button>
      <button style={item} onClick={() => onTab('trees')}>
        <span style={iconStyle(tab === 'trees')}><IconTree size={21} strokeWidth={1.6} /></span>
        <span style={labelStyle(tab === 'trees')}>{t('m.tabTrees')}</span>
      </button>
      <button style={item} onClick={onReview}>
        <span style={iconStyle(false)}><IconReview size={21} /></span>
        <span style={labelStyle(false)}>{t('m.tabReview')}</span>
        {reviewDot && <span style={{ position: 'absolute', top: 6, right: '26%', width: 7, height: 7, borderRadius: '50%', background: 'var(--m-accent)' }} />}
      </button>
      <button style={item} onClick={() => onTab('notes')}>
        <span style={iconStyle(tab === 'notes')}><IconNotes size={21} /></span>
        <span style={labelStyle(tab === 'notes')}>{t('m.tabNotes')}</span>
      </button>
    </div>
  )
}
