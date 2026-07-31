'use client'
/**
 * Per-message error boundary — a bad render (a malformed highlight anchor,
 * a KaTeX edge case, a markdown parser hiccup) degrades ONE message to its
 * plain text instead of tripping the app-level boundary and blanking the
 * whole workspace ("Application error"). That failure mode permanently
 * bricked a node: the crash re-fired on every load of the saved conversation.
 *
 * Remount-to-retry: key this boundary by anything that changes the render
 * input (message id + highlight count) so e.g. deleting a bad highlight
 * gives the rich renderer another chance.
 */
import React from 'react'

interface Props {
  /** The message's raw text — the fallback rendering. */
  fallbackText: string
  /** Localized one-line note shown under the degraded text. */
  degradedNote?: string
  children: React.ReactNode
}

interface State { failed: boolean }

export class MessageErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    try { console.warn('[workspace] message render degraded to plain text:', error) } catch { /* noop */ }
  }

  render() {
    if (this.state.failed) {
      return (
        <div>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{this.props.fallbackText}</p>
          {this.props.degradedNote && (
            <p className="mt-2 text-[10px] text-muted-foreground/70">{this.props.degradedNote}</p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
