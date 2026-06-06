# UI Cleanup — Minimalist Redesign

## Dashboard Home (src/app/dashboard/page.tsx)
Strip it down to essentials only:

### Keep (above the fold):
- Welcome message with student name
- ONE row of 3-4 key stats: XP level, current streak, learning stage, overall progress %
- One prominent CTA: "Continue Learning" → goes to last active topic or AI tutor

### Remove from dashboard:
- Activity feed (move to a separate tab or remove)
- Upcoming tasks section (move to Projects tab)
- Quick links grid (not needed — sidebar handles navigation)
- Any stat cards beyond the core 3-4

### Design:
- Lots of white space
- Cards with very subtle borders (border-border/50)
- Stats should use large numbers, small labels
- No icon clutter — only use icons where they genuinely help
- Muted colors, accent color only for the primary CTA
- The dashboard should feel calm, not busy

## Sidebar (src/components/sidebar.tsx)
- Keep it clean: icon + label for each item
- Items: Dashboard, Roadmap, Progress, AI Tutor (Bob), Projects, Settings
- Admin section only visible for teacher role
- Collapsible on desktop (icon-only mode)
- Active state: subtle highlight, no heavy background
- At the bottom: user avatar + name, theme toggle

## General Principles
- Remove ALL redundant information
- If a stat appears on its dedicated page, it doesn't need to be on the dashboard
- White space is a feature, not wasted space
- Typography hierarchy: one big number/title, small descriptive text underneath
- Reduce border-radius inconsistency (pick one: rounded-lg everywhere)
- Tone down animations — only use for meaningful state changes, not decorative
- Remove any "card within card" nesting

## Pages to Simplify
Each page should have a clean header (title + optional subtitle) and then content. No heavy banners or hero sections on interior pages.

- Progress page: keep charts, but remove the heavy stage banner — make it a small indicator
- Projects page: clean card list, no stats row at top (move stats into individual project pages)
- Chat page: full-screen chat, minimal chrome — the conversation IS the page
- Settings: grouped sections with dividers, not cards

## Don't Touch
- Knowledge graph (Roadmap) — it's complex by nature, that's fine
- AI tutor chat functionality — only simplify the chrome around it
- Project detail pages — they need their detail
