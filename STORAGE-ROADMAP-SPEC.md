# Storage & Roadmap Overhaul Spec

Read FOUNDATION.md for context. Key reference: "Document/Recordings Drive — learning tools attached to course segments"

## 1. Project Storage Folder UI

### New component: src/components/project-storage.tsx
A file storage panel embedded in each project detail page (src/app/dashboard/projects/[id]/page.tsx).

**Features:**
- File list with icons by type: PDF (red), Markdown (gray), Google Docs (blue), Google Slides (yellow), Google Sheets (green)
- Upload button — accepts: .pdf, .md, .txt files (stored locally for now via /api/files/upload)
- "Link Google File" button — opens a modal where student pastes a Google Docs/Slides/Sheets URL
  - Parse the URL to detect type (docs.google.com/document, /spreadsheets, /presentation)
  - Store as a linked reference (title + URL + type + linked date)
  - Show with Google icon + file type badge
- File list shows: icon, filename, type badge, date added, size (for uploads) or "Linked" tag
- Click file: opens in new tab (Google files open their URL, uploaded files download)
- Delete button per file (with confirmation)
- Empty state: "No files yet — upload project files or link Google documents"
- Drag-and-drop upload zone

### API routes:
- POST /api/files/upload — multipart upload, saves to /public/uploads/[projectId]/
- GET /api/files/[projectId] — list files for a project
- DELETE /api/files/[fileId] — delete a file
- POST /api/files/link — save a Google file link (url, title, type)

### For demo mode:
- Mock file list with 2-3 sample files per project (a PDF, a Google Doc link, a markdown file)
- Upload simulates success and adds to the in-memory list
- Store in demoStore

## 2. Subject-Categorized Projects & Assignments

### Update mock data (src/lib/mock-data.ts):
Every project and assignment MUST have a `subject` field matching one of the roadmap subjects:
- CS, Math, Psychology, Finance, General

Add an `assignments` array to mock data — smaller tasks within subjects:
```typescript
interface Assignment {
  id: string
  title: string
  subject: string  // must match roadmap subject
  projectId?: string  // optional parent project
  description: string
  status: 'not-started' | 'in-progress' | 'completed'
  dueDate?: string
  competencies: string[]
}
```

Update existing projects to each have a clear subject category.

### Update types (src/types/index.ts):
Add Assignment type, add `subject` to Project type if not present.

## 3. Roadmap Overhaul — Clean Interactive Tree

### COMPLETELY REWRITE src/app/dashboard/roadmap/page.tsx and src/components/knowledge-graph.tsx

The current force-graph is too chaotic. Replace with a CLEAN, STRUCTURED layout:

### New design: Subject-based collapsible tree with visual connections

**Layout:**
- Left sidebar: list of subjects as clickable tabs (CS, Math, Psychology, Finance, General)
- Main area: selected subject's roadmap as a VERTICAL TREE / flowchart
  - Top-to-bottom flow
  - Nodes are rounded cards (not circles): topic name, status icon, brief description
  - Edges are smooth curved lines connecting prerequisites
  - Color-coded by status: completed (green border), in-progress (blue border + pulse), available (white border), locked (gray, dimmed)
  - Nodes have gentle spacing — NOT crammed together
  - Max 3-4 nodes per horizontal level

**Interaction:**
- Click a subject tab → shows that subject's roadmap tree
- Click a node → expands an info panel on the right:
  - Topic name, description, estimated time
  - Prerequisites (with links to those nodes)
  - Status + progress indicator
  - **Projects under this topic** — list of related projects with status badges, click to go to project detail
  - **Assignments under this topic** — list of assignments with checkboxes
  - Resources list
  - "Start Learning" / "Continue" / "Completed" button
- Hover a node → subtle glow + show connections highlighted
- Completed nodes show a checkmark overlay

**Visual style:**
- Clean white/dark cards with subtle shadows
- Thin connection lines (1-2px), curved bezier paths
- Lots of whitespace between nodes
- Smooth animations when expanding/collapsing
- No physics simulation — fixed positions calculated by layout algorithm
- Use a simple tree layout: organize nodes in levels based on prerequisite depth

**Implementation:**
- DON'T use react-force-graph-2d (too chaotic)
- Use plain React + SVG for connections + CSS for node cards
- OR use reactflow (install it: npm install reactflow) which gives a clean flowchart layout
- Calculate node positions: group by prerequisite depth (level 0 = no prereqs, level 1 = depends on level 0, etc.)
- Horizontal centering per level

### Projects & Assignments under each roadmap node:
When you click a topic node, the detail panel shows:
- "Related Projects" section: cards for each project with that subject, showing title + progress bar + status
- "Assignments" section: checklist-style items for assignments in that topic

## 4. Update Sidebar Navigation
Make sure "Roadmap" link works and goes to the new clean roadmap.

## 5. Don't Break
- Dashboard home
- AI Tutor chat
- Progress page
- Settings
- Admin pages
- Project detail pages (but ADD the storage component to them)

## Implementation Order
1. Add Assignment type + update mock data with subjects and assignments
2. Build project-storage component + API routes
3. Add storage to project detail pages
4. Rewrite roadmap as clean tree (this is the big one)
5. Wire projects/assignments into roadmap node details
6. Run npm run build — must pass clean
