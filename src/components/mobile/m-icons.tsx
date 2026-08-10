'use client'
/** The design's inline icon set, verbatim strokes (Nocturne 1.6–1.8 weight).
 *  All stroke currentColor so the caller colors via CSS/style. */

type P = { size?: number; strokeWidth?: number; style?: React.CSSProperties; className?: string }

function svg(paths: React.ReactNode, { size = 16, strokeWidth = 1.7, style, className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ width: size, height: size, flex: 'none', ...style }} className={className}>
      {paths}
    </svg>
  )
}

export const IconFlame = (p: P) => svg(
  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z" />, p)

export const IconToday = (p: P) => svg(<>
  <path d="M12 3v2" /><path d="M18.4 5.6 17 7" /><path d="M5.6 5.6 7 7" />
  <path d="M7 15a5 5 0 0 1 10 0" /><path d="M3 15h18" /><path d="M6 19h12" />
</>, p)

export const IconTree = (p: P) => svg(<>
  <path d="M12 22V13" /><path d="M12 13C12 10 9.5 9 8 6.5" /><path d="M12 13C12 10 14.5 9 16 6.5" />
  <path d="M8 6.5C7.2 5 5.8 4.6 5 3.5" /><path d="M8 6.5C8.4 4.8 8 3.8 8.6 2.4" />
  <path d="M16 6.5C16.8 5 18.2 4.6 19 3.5" /><path d="M16 6.5C15.6 4.8 16 3.8 15.4 2.4" />
  <path d="M12 9.5C12 7.6 12 6.4 12 4.8" />
</>, { strokeWidth: 1.6, ...p })

export const IconReview = (p: P) => svg(<>
  <rect x="4" y="7" width="16" height="13" rx="2" /><path d="M8 4h8" /><path d="m9 13 2 2 4-4" />
</>, p)

export const IconNotes = (p: P) => svg(<>
  <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
</>, p)

export const IconHeadphones = (p: P) => svg(<>
  <path d="M4 14a8 8 0 0 1 16 0" />
  <rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" />
</>, p)

export const IconChevronRight = (p: P) => svg(<path d="m10 6 6 6-6 6" />, p)
export const IconChevronLeft = (p: P) => svg(<path d="m14 6-6 6 6 6" />, { strokeWidth: 1.8, ...p })
export const IconCheck = (p: P) => svg(<path d="m5 13 4 4L19 7" />, { strokeWidth: 2, ...p })
export const IconX = (p: P) => svg(<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>, { strokeWidth: 2, ...p })
export const IconSend = (p: P) => svg(<>
  <path d="M21.5 2.5 10.6 13.4" /><path d="m21.5 2.5-7 19-3.9-8.1L2.5 9.5z" />
</>, p)

export const IconShield = (p: P) => svg(<>
  <path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="m9 12 2 2 4-4" />
</>, p)

export const IconPause = (p: P) => svg(<><path d="M8 5v14" /><path d="M16 5v14" /></>, { strokeWidth: 1.8, ...p })

export const IconSketch = (p: P) => svg(<>
  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 15 4-4 4 4 5-5 5 5" />
</>, { strokeWidth: 1.5, ...p })
