'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useStudentData } from '@/lib/student-data'

// Reads URL search params at runtime, so it can't be statically prerendered —
// render dynamically to avoid the useSearchParams() CSR bailout during build.
export const dynamic = 'force-dynamic'

interface PortfolioSkill {
  name: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  evidence: string
}

interface PortfolioProject {
  title: string
  description: string
  skills: string[]
  impact: string
}

interface PortfolioStrength {
  trait: string
  description: string
  evidence: string
  conversationRef: string
}

interface PortfolioGrowthArea {
  area: string
  description: string
  progress: string
}

interface PortfolioMetrics {
  completionRate: number | string | Record<string, unknown>
  averagePace: string
  consistencyScore: number | string
  qualityIndicators: string[]
}

interface Portfolio {
  headline: string
  summary: string
  skills: PortfolioSkill[]
  projects: PortfolioProject[]
  strengths: PortfolioStrength[]
  growthAreas: PortfolioGrowthArea[]
  metrics: PortfolioMetrics
  personalStatement: string
  insufficientData?: boolean
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !isNaN(v)) return Math.max(0, Math.min(100, Math.round(v)))
  if (typeof v === 'string') {
    const match = v.match(/(\d+(\.\d+)?)/)
    if (match) return Math.max(0, Math.min(100, Math.round(parseFloat(match[1]))))
  }
  return fallback
}

function normalizeLevel(level: string): 'beginner' | 'intermediate' | 'advanced' | 'expert' {
  const lc = (level || '').toLowerCase()
  if (lc.includes('expert')) return 'expert'
  if (lc.includes('advanced')) return 'advanced'
  if (lc.includes('intermediate')) return 'intermediate'
  return 'beginner'
}

const LEVEL_ORDER = { expert: 0, advanced: 1, intermediate: 2, beginner: 3 }
const LEVEL_WIDTHS: Record<string, number> = { expert: 100, advanced: 75, intermediate: 50, beginner: 25 }

function PortfolioPrintContent() {
  const { data } = useStudentData()
  const { student } = data
  const searchParams = useSearchParams()
  const autoPrint = searchParams.get('autoprint') !== '0'

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [personalStatement, setPersonalStatement] = useState<string>('')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const hasPrintedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/portfolio/status', { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setLoadState('error')
          return
        }
        const data = (await res.json()) as { status: string; portfolio?: Portfolio }
        if (cancelled) return
        if (data.status === 'ready' && data.portfolio) {
          setPortfolio(data.portfolio)
          setPersonalStatement(data.portfolio.personalStatement || '')
          setLoadState('ready')
        } else {
          setLoadState('missing')
        }
      } catch {
        if (!cancelled) setLoadState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!autoPrint) return
    if (loadState !== 'ready') return
    if (hasPrintedRef.current) return
    if (!student.name || student.name === 'Loading...') return
    hasPrintedRef.current = true
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [loadState, student.name, autoPrint])

  if (loadState === 'loading' || (loadState === 'ready' && student.name === 'Loading...')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-neutral-700 font-serif">
        <div className="text-sm">Preparing your portfolio…</div>
      </div>
    )
  }

  if (loadState === 'error' || loadState === 'missing' || !portfolio) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-neutral-700 font-serif">
        <div className="max-w-md text-center space-y-3 px-6">
          <p className="text-base font-medium">No portfolio available to export.</p>
          <p className="text-sm text-neutral-500">
            Go back to the portfolio page and generate one first.
          </p>
        </div>
      </div>
    )
  }

  const sortedSkills = (portfolio.skills ?? [])
    .map((s) => ({ ...s, level: normalizeLevel(s.level) }))
    .sort((a, b) => (LEVEL_ORDER[a.level] ?? 4) - (LEVEL_ORDER[b.level] ?? 4))

  const completionPct = toNumber(portfolio.metrics?.completionRate)
  const consistencyPct = toNumber(portfolio.metrics?.consistencyScore)

  return (
    <div className="print-root bg-white text-neutral-900">
      <style jsx global>{`
        @page {
          size: letter;
          margin: 0.6in 0.65in 0.75in 0.65in;
          @bottom-left {
            content: "Release EDU · releaseedu.com";
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 8.5pt;
            color: #666;
          }
          @bottom-right {
            content: "Page " counter(page) " of " counter(pages);
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 8.5pt;
            color: #666;
          }
          @top-right {
            content: "VERIFIED PORTFOLIO";
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 7.5pt;
            letter-spacing: 0.2em;
            color: #999;
          }
        }
        @media print {
          html,
          body {
            background: #fff !important;
            color: #111 !important;
          }
          .no-print {
            display: none !important;
          }
        }
        .print-root {
          font-family: Georgia, 'Times New Roman', Cambria, serif;
          font-size: 10.5pt;
          line-height: 1.55;
          color: #111;
          max-width: 7.25in;
          margin: 0 auto;
          padding: 0.5in 0.25in;
        }
        @media print {
          .print-root {
            padding: 0;
            max-width: none;
          }
        }
        .print-root h1 {
          font-family: Georgia, serif;
          font-size: 22pt;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.1;
          margin: 0 0 4pt 0;
        }
        .print-root h2 {
          font-family: Georgia, serif;
          font-size: 11pt;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #444;
          border-bottom: 0.75pt solid #bbb;
          padding-bottom: 3pt;
          margin: 18pt 0 9pt 0;
        }
        .print-root h3 {
          font-family: Georgia, serif;
          font-size: 11pt;
          font-weight: 700;
          margin: 0 0 2pt 0;
        }
        .print-root p {
          margin: 0 0 6pt 0;
        }
        .print-root section {
          page-break-inside: auto;
        }
        .print-root .avoid-break {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .print-root .rule-label {
          font-size: 8.5pt;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: #666;
          font-weight: 600;
        }
        .print-root blockquote {
          margin: 4pt 0 0 0;
          padding: 0 0 0 10pt;
          border-left: 2pt solid #ccc;
          color: #444;
          font-style: italic;
          font-size: 9.5pt;
        }
        .print-root blockquote cite {
          display: block;
          font-style: normal;
          color: #888;
          font-size: 8pt;
          margin-top: 2pt;
        }
        .print-root .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12pt 20pt;
        }
        .print-root .skill-bar {
          height: 3pt;
          background: #e8e8e8;
          border-radius: 2pt;
          overflow: hidden;
          margin-top: 2pt;
        }
        .print-root .skill-bar > div {
          height: 100%;
          background: #222;
        }
        .print-root .meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 14pt;
          font-size: 9pt;
          color: #555;
          margin-top: 8pt;
        }
        .print-root .meta-row span strong {
          color: #111;
        }
        .print-root .header-rule {
          border-bottom: 1.5pt solid #111;
          padding-bottom: 10pt;
          margin-bottom: 2pt;
        }
        .print-root .tag {
          display: inline-block;
          font-size: 8.5pt;
          padding: 1pt 6pt;
          border: 0.5pt solid #bbb;
          border-radius: 2pt;
          margin: 0 3pt 3pt 0;
          color: #333;
        }
        .print-root .metric-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10pt;
          margin-top: 4pt;
        }
        .print-root .metric-cell {
          border: 0.5pt solid #ccc;
          padding: 8pt 10pt;
          border-radius: 2pt;
        }
        .print-root .metric-cell .num {
          font-size: 18pt;
          font-weight: 700;
          line-height: 1.1;
        }
        .print-root .metric-cell .lbl {
          font-size: 8.5pt;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #666;
          margin-top: 2pt;
        }
        .print-root ul {
          margin: 4pt 0 6pt 0;
          padding-left: 16pt;
        }
        .print-root ul li {
          margin-bottom: 2pt;
        }
        .print-root .footer-note {
          margin-top: 24pt;
          padding-top: 10pt;
          border-top: 0.5pt solid #ccc;
          font-size: 8.5pt;
          color: #777;
          font-style: italic;
        }
      `}</style>

      {/* Screen-only print button */}
      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <button
          onClick={() => window.print()}
          className="bg-neutral-900 text-white text-sm px-4 py-2 rounded-md hover:bg-neutral-700"
        >
          Print / Save as PDF
        </button>
        <button
          onClick={() => window.close()}
          className="border border-neutral-300 text-neutral-700 text-sm px-4 py-2 rounded-md hover:bg-neutral-100"
        >
          Close
        </button>
      </div>

      {/* Header */}
      <header className="header-rule avoid-break">
        <h1>{student.name}</h1>
        <p style={{ fontSize: '11pt', color: '#444', margin: '2pt 0 0 0' }}>
          {portfolio.headline}
        </p>
        <div className="meta-row">
          <span>
            <strong>{student.xp.toLocaleString()}</strong> XP
          </span>
          <span>
            <strong>{student.streak}</strong>-day streak
          </span>
          <span>
            <strong>{completionPct}%</strong> completion
          </span>
          <span>
            <strong>{sortedSkills.length}</strong> skills tracked
          </span>
        </div>
      </header>

      {/* Professional Summary */}
      {portfolio.summary && (
        <section>
          <h2>Professional Summary</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{portfolio.summary}</p>
        </section>
      )}

      {/* Personal Statement */}
      {personalStatement && (
        <section>
          <h2>Personal Statement</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{personalStatement}</p>
        </section>
      )}

      {/* Skills */}
      {sortedSkills.length > 0 && (
        <section>
          <h2>Skills &amp; Competencies</h2>
          <div className="two-col">
            {sortedSkills.map((skill, i) => (
              <div key={i} className="avoid-break">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3>{skill.name}</h3>
                  <span className="rule-label">{skill.level}</span>
                </div>
                <div className="skill-bar">
                  <div style={{ width: `${LEVEL_WIDTHS[skill.level] ?? 25}%` }} />
                </div>
                {skill.evidence && (
                  <p style={{ fontSize: '9.5pt', color: '#444', marginTop: '4pt' }}>
                    {skill.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      {Array.isArray(portfolio.projects) && portfolio.projects.length > 0 && (
        <section>
          <h2>Projects</h2>
          {portfolio.projects.map((project, i) => (
            <div key={i} className="avoid-break" style={{ marginBottom: '12pt' }}>
              <h3>{project.title}</h3>
              <p style={{ fontSize: '10pt', color: '#333' }}>{project.description}</p>
              {Array.isArray(project.skills) && project.skills.length > 0 && (
                <div style={{ marginTop: '3pt' }}>
                  {project.skills.map((s, j) => (
                    <span key={j} className="tag">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {project.impact && (
                <p style={{ fontSize: '9.5pt', color: '#555', marginTop: '4pt' }}>
                  <span className="rule-label">Impact &middot;</span> {project.impact}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Strengths */}
      {Array.isArray(portfolio.strengths) && portfolio.strengths.length > 0 && (
        <section>
          <h2>Character &amp; Strengths</h2>
          <p style={{ fontSize: '9pt', color: '#666', marginTop: '-4pt', marginBottom: '8pt' }}>
            Identified through AI analysis of learning conversations. Each strength is backed by direct evidence.
          </p>
          {portfolio.strengths.map((s, i) => (
            <div key={i} className="avoid-break" style={{ marginBottom: '10pt' }}>
              <h3>{s.trait}</h3>
              <p style={{ fontSize: '10pt', color: '#333' }}>{s.description}</p>
              {s.evidence && (
                <blockquote>
                  &ldquo;{s.evidence}&rdquo;
                  {s.conversationRef && <cite>From: {s.conversationRef}</cite>}
                </blockquote>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Growth Areas */}
      {Array.isArray(portfolio.growthAreas) && portfolio.growthAreas.length > 0 && (
        <section>
          <h2>Growth Areas</h2>
          {portfolio.growthAreas.map((a, i) => (
            <div key={i} className="avoid-break" style={{ marginBottom: '8pt' }}>
              <h3>{a.area}</h3>
              <p style={{ fontSize: '10pt', color: '#333' }}>{a.description}</p>
              {a.progress && (
                <p style={{ fontSize: '9pt', color: '#555' }}>
                  <span className="rule-label">Progress &middot;</span> {a.progress}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Metrics */}
      {portfolio.metrics && (
        <section className="avoid-break">
          <h2>Metrics</h2>
          <div className="metric-grid">
            <div className="metric-cell">
              <div className="num">{completionPct}%</div>
              <div className="lbl">Completion</div>
            </div>
            <div className="metric-cell">
              <div className="num">{consistencyPct}%</div>
              <div className="lbl">Consistency</div>
            </div>
            <div className="metric-cell">
              <div className="num" style={{ fontSize: '11pt', fontWeight: 600 }}>
                {typeof portfolio.metrics.averagePace === 'string' && portfolio.metrics.averagePace
                  ? portfolio.metrics.averagePace
                  : '—'}
              </div>
              <div className="lbl">Pace</div>
            </div>
          </div>
          {Array.isArray(portfolio.metrics.qualityIndicators) &&
            portfolio.metrics.qualityIndicators.length > 0 && (
              <div style={{ marginTop: '10pt' }}>
                <div className="rule-label" style={{ marginBottom: '4pt' }}>
                  Quality Signals
                </div>
                <ul>
                  {portfolio.metrics.qualityIndicators.map((q, i) => (
                    <li key={i} style={{ fontSize: '9.5pt' }}>
                      {typeof q === 'string' ? q : JSON.stringify(q)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </section>
      )}

      {/* Footer */}
      <div className="footer-note">
        AI-generated portfolio by Release EDU · Generated {new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
        . Content reflects the student&rsquo;s learning activity at time of generation and may contain AI-generated interpretations.
      </div>
    </div>
  )
}

// useSearchParams() must sit inside a Suspense boundary or the production build
// fails the static-generation pass for this route.
export default function PortfolioPrintPage() {
  return (
    <Suspense fallback={null}>
      <PortfolioPrintContent />
    </Suspense>
  )
}
