'use client'
/**
 * RESOURCE CARDS — the clickable half of the Visual Confidence & Honest
 * Redirect law (FOUNDATION.md).
 *
 * When Bob judges at authoring time that no static diagram can honestly
 * deliver what the learner needs, he points at the real thing instead. That
 * recommendation used to ship as prose ("see Google's 2024 Nature paper,
 * Fig. 1 and Fig. 3") — genuinely good advice that a beginner will never act
 * on, because there is nothing to click. Bob now emits a ```resources block
 * and it renders here: name, why this one, and exactly what to look at.
 */
import { ExternalLink, BookOpen } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export interface LearningResource {
  name: string
  url?: string
  why?: string
  /** What specifically to look at once there — "Fig. 1 and Fig. 3", a section. */
  look?: string
}

/** Parse a ```resources block body: a JSON array, or one item per line. */
export function parseResources(raw: string): LearningResource[] {
  const text = raw.trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((r): r is LearningResource => !!r && typeof r.name === 'string' && r.name.trim().length > 0)
        .map(r => ({
          name: String(r.name).slice(0, 160),
          url: typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url : undefined,
          why: typeof r.why === 'string' ? r.why.slice(0, 400) : undefined,
          look: typeof r.look === 'string' ? r.look.slice(0, 200) : undefined,
        }))
        .slice(0, 4)
    }
  } catch { /* fall through to the line form */ }
  // Tolerant fallback: "Name — why | https://url"
  return text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4).map(line => {
    const url = line.match(/https?:\/\/\S+/)?.[0]
    const name = line.replace(/https?:\/\/\S+/, '').replace(/[—|-]\s*$/, '').trim() || (url ?? 'Resource')
    return { name: name.slice(0, 160), url }
  })
}

export function ResourceCards({ resources }: { resources: LearningResource[] }) {
  const { t } = useLanguage()
  if (resources.length === 0) return null
  return (
    <div className="my-3 space-y-2">
      <p className="text-[11px] font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
        <BookOpen className="w-3.5 h-3.5" /> {t('visual.resourcesTitle')}
      </p>
      {resources.map((r, i) => {
        const body = (
          <>
            <div className="flex items-start gap-2">
              <ExternalLink className="w-3.5 h-3.5 text-sky-300 flex-shrink-0 mt-0.5" />
              <span className="text-[13px] font-semibold text-foreground leading-snug">{r.name}</span>
            </div>
            {r.why && <p className="text-[11px] text-muted-foreground leading-snug mt-1">{r.why}</p>}
            {r.look && (
              <p className="text-[11px] text-sky-200/90 leading-snug mt-1">
                <span className="font-semibold">{t('visual.lookAt')}:</span> {r.look}
              </p>
            )}
          </>
        )
        const cls = 'block rounded-xl border border-sky-400/30 bg-sky-500/[0.06] px-3 py-2.5 transition-colors'
        return r.url ? (
          <a
            key={`${r.name}-${i}`}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${cls} hover:border-sky-400/60 hover:bg-sky-500/[0.12]`}
          >
            {body}
          </a>
        ) : (
          <div key={`${r.name}-${i}`} className={cls}>{body}</div>
        )
      })}
    </div>
  )
}
