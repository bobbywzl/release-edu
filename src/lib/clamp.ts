/**
 * clampText — length-limit user-facing strings WITHOUT mid-word amputation.
 *
 * The simulation audit caught judge feedback and insight rows rendered as
 * "…you correctly caught the bon" / "Think of it like a st" — hard slice()
 * cuts at peak-salience moments. This trims at the last sentence boundary
 * within the limit (preferred) or the last word boundary + ellipsis.
 */
export function clampText(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  // Prefer a sentence boundary in the back half of the allowance.
  const sentenceEnd = Math.max(
    cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '),
    cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'),
  )
  if (sentenceEnd > max * 0.5) return cut.slice(0, sentenceEnd + 1).trim()
  // Otherwise cut at a word boundary and mark the elision.
  const wordEnd = cut.lastIndexOf(' ')
  return (wordEnd > max * 0.5 ? cut.slice(0, wordEnd) : cut).trim() + '…'
}
