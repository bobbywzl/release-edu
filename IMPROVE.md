# Improvement Task

Read FOUNDATION.md for context on all educational philosophy decisions.

## 1. Knowledge Map Overhaul (src/components/knowledge-graph.tsx)

### Physics & Interaction
- Tune force simulation: stronger repulsion between nodes (charge: -300), longer link distance (120), center gravity (0.05)
- Nodes cluster by subject with visible group boundaries (faint colored backgrounds behind clusters)
- Node size proportional to importance/connections (more connections = bigger)
- Hover effects: highlight connected nodes, dim unconnected ones
- Click node: expand to show sub-topics as smaller satellite nodes around it
- Double-click node: navigate to a detail view
- Smooth zoom-to-fit on initial load
- Add a legend showing color = subject, size = importance, status icons

### Sub-Category Customization
- Add a filter panel on the side: toggle subject categories on/off
- Search bar to find specific nodes
- Layout presets: "cluster by subject", "radial from current position", "timeline left-to-right"
- Ability to pin/unpin nodes

### Visual Polish
- Animated edges (dashed for prerequisites, solid for completed paths)
- Glow effect on available/in-progress nodes
- Particle effects flowing along completed paths
- Mini-map in corner showing full graph overview

## 2. Project Detail Pages

### Create src/app/dashboard/projects/[id]/page.tsx
- Individual project page when you click a project card
- Hero section: project name, description, status badge, due date countdown
- **Tasks tab**: checklist of tasks with completion status, drag to reorder
- **Timeline tab**: visual timeline/Gantt of project milestones
- **Competencies tab**: which competencies this project develops, progress per competency
- **Collaborators tab**: team members, their contributions, activity feed
- **Resources tab**: linked learning materials, AI tutor suggestions
- Add back button and breadcrumb navigation
- Progress ring showing overall project completion

### Update project cards (src/app/dashboard/projects/page.tsx)
- Cards link to /dashboard/projects/[id]
- Add hover animation (slight lift + shadow)
- Quick action buttons: continue, share, archive

## 3. Live Progress Views (src/app/dashboard/progress/page.tsx)

### Time-Series Charts (use recharts library — install it)
- **XP over time**: line chart showing daily/weekly XP earned over past 30/90 days
- **Subject mastery over time**: multi-line chart, one line per subject
- **Learning stage transitions**: timeline showing when student moved between stages
- **Streak calendar**: GitHub-style contribution heatmap showing daily activity
- **Session duration chart**: bar chart of study time per day

### Interactive Features
- Toggle between time ranges (7d, 30d, 90d, all time)
- Hover on data points for details
- Click a day on the heatmap to see what was studied
- Animated counters for stats (count up on page load)

## 4. General UI Polish

### Transitions & Animations
- Page transitions with framer-motion (fade + slide)
- Skeleton loading states for all data-heavy components
- Smooth number animations for stats/counters
- Subtle parallax on dashboard cards

### Interactivity
- Dashboard cards: clickable, link to relevant pages
- Recent activity items: clickable, expand for details
- Tooltips on all icons and abbreviated text
- Keyboard shortcuts: Cmd+K for search, number keys for nav
- Toast notifications for actions (settings saved, project updated, etc.)
- Add a command palette (Cmd+K) for quick navigation

### Mobile Polish
- Collapsible sidebar with hamburger menu
- Bottom navigation bar on mobile
- Touch-friendly tap targets
- Swipe gestures on project cards

## Tech Notes
- Install recharts: `npm install recharts`
- Keep all mock data in src/lib/mock-data.ts — add time-series data
- Maintain dark navy + electric blue design system
- All new components should use framer-motion for enter/exit animations
- Keep TypeScript strict — no any types except where unavoidable
