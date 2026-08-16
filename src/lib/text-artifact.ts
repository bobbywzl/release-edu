/**
 * Text-artifact decoding (qa-findings-4 №1): the checkpoint card and some
 * upload paths read EVERY file with readAsDataURL, so a CSV/log/text file
 * arrives base64-wrapped in a data: URI and nothing downstream could read
 * it — the evidence judge graded blind. This is the one shared decoder:
 * data:text-ish URI → plain UTF-8 text, or null when the payload is
 * genuinely binary.
 */

// Mime types whose data: payload should decode to legible text. An empty or
// octet-stream mime still gets a decode ATTEMPT — the binary sniff decides.
const TEXTISH_MIME = /^text\/|(json|xml|csv|yaml|javascript|typescript|markdown|x-sh|x-python)/i

/** True when this mime plausibly wraps text (or is unknown enough to try). */
export function isTextishMime(mime: string | null | undefined): boolean {
  const m = (mime ?? '').trim()
  if (!m || m === 'application/octet-stream') return true
  if (/^(image|audio|video)\//.test(m) || m === 'application/pdf') return false
  return TEXTISH_MIME.test(m)
}

/**
 * Decode a data: URI to plain text. Returns null when the URI is malformed,
 * the payload doesn't decode, or the decoded bytes look binary (NULs /
 * replacement-character noise) — callers treat null as "not readable text".
 */
export function decodeDataUriText(uri: string): string | null {
  if (!uri.startsWith('data:')) return null
  const comma = uri.indexOf(',')
  if (comma === -1) return null
  const meta = uri.slice(5, comma) // e.g. "text/csv;base64"
  const payload = uri.slice(comma + 1)
  try {
    const text = /;base64$/i.test(meta)
      ? Buffer.from(payload, 'base64').toString('utf-8')
      : decodeURIComponent(payload)
    if (!text.trim()) return null
    if (text.includes('\u0000')) return null
    // Replacement-character density sniff: real text decodes clean; binary
    // mislabeled as text fills with U+FFFD.
    const sample = text.slice(0, 2000)
    const bad = (sample.match(/�/g) ?? []).length
    if (bad > Math.max(2, sample.length * 0.02)) return null
    return text
  } catch {
    return null
  }
}
