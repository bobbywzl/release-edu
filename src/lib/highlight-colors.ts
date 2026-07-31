/**
 * Highlight color palette — shared by the selection toolbar
 * (highlightable-text) and the declarative mark renderer
 * (markdown-renderer). Inline styles, not Tailwind classes: the colors are
 * data-driven and JIT can't see them.
 */
export const HIGHLIGHT_COLOR_STYLES: Record<string, { background: string; borderBottom: string }> = {
  amber:  { background: 'rgba(251,191,36,0.30)',  borderBottom: '2px solid rgba(251,191,36,0.70)' },
  blue:   { background: 'rgba(96,165,250,0.30)',  borderBottom: '2px solid rgba(96,165,250,0.70)' },
  green:  { background: 'rgba(52,211,153,0.30)',  borderBottom: '2px solid rgba(52,211,153,0.70)' },
  purple: { background: 'rgba(167,139,250,0.30)', borderBottom: '2px solid rgba(167,139,250,0.70)' },
}

export const HIGHLIGHT_COLOR_SWATCHES: Record<string, string> = {
  amber: '#FBBF24', blue: '#60A5FA', green: '#34D399', purple: '#A78BFA',
}
