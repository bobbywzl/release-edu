/**
 * Tree EDU logo — a bare branching tree, minimal single-stroke style
 * (from the user's sketch: trunk forking upward into fine branches).
 */
export function TreeLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* trunk */}
      <path d="M12 22V13" />
      {/* main fork */}
      <path d="M12 13C12 10 9.5 9 8 6.5" />
      <path d="M12 13C12 10 14.5 9 16 6.5" />
      {/* secondary branches */}
      <path d="M8 6.5C7.2 5 5.8 4.6 5 3.5" />
      <path d="M8 6.5C8.4 4.8 8 3.8 8.6 2.4" />
      <path d="M16 6.5C16.8 5 18.2 4.6 19 3.5" />
      <path d="M16 6.5C15.6 4.8 16 3.8 15.4 2.4" />
      {/* mid sprout */}
      <path d="M12 9.5C12 7.6 12 6.4 12 4.8" />
    </svg>
  )
}
