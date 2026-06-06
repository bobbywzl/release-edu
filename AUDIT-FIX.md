# Audit Fix — Remove All Demo Data Leaks

Every page must use `useStudentData()` from `@/lib/student-data` instead of importing directly from `@/lib/mock-data`. The data from useStudentData() comes from the API which returns the user's actual generated curriculum (or default traditional subjects for new users).

## Pages to Fix

### 1. src/app/dashboard/projects/page.tsx
- Currently imports `mockProjects, mockStudent` from mock-data
- Replace with `useStudentData()` — use `data.projects` and `data.student`
- Projects shown should come from the curriculum's project modules, NOT hardcoded Alex Chen projects

### 2. src/app/dashboard/projects/[id]/page.tsx  
- Currently imports from mock-data for project details, tasks, milestones
- Should look up the project by ID from `useStudentData().data.projects`
- If project not found in student data, show "Project not found"
- Tasks and milestones can be empty/mock for now but project identity must match curriculum

### 3. src/app/dashboard/progress/page.tsx
- Currently imports mockStudent, mockSubjectProgress, mockAchievements, mockKnowledgeNodes, mockProjects, mockXPData, mockSubjectMastery, mockSessionData, mockHeatmapData
- Replace mockStudent with `data.student`, mockKnowledgeNodes with `data.knowledgeNodes`, mockProjects with `data.projects`
- Chart data (XP, mastery, session, heatmap) can stay as mock for now since those are time-series and the student hasn't generated any yet
- But the key stats (XP, level, streak, stage, node counts, project counts) MUST come from student data

### 4. src/app/dashboard/settings/page.tsx
- Currently imports mockStudent from mock-data
- Replace with `useStudentData()` — use `data.student` for name, email, level, stage, joinedAt
- Name and email should be editable
- Profile photo uploader already exists — keep it
- ALL settings buttons/toggles should work (they currently just update local state, which is fine for now)
- Add a "Personal Info" section: name, email, birthdate (new field), timezone
- The "Save changes" button should show a toast confirmation

### 5. Google account data
- When signed in via Google OAuth, the user's name, email, and photo should automatically populate
- Check if NextAuth session data is available and use it as defaults
- In settings, show the Google-connected email as read-only, display name as editable

## Additional: Ensure the student-data API returns proper user info

Update src/app/api/student-data/route.ts:
- For Google-authenticated users (not demo mode): use session.user.name, session.user.email, session.user.image
- Return these in the student object so pages can display real user info
- For demo mode: use whatever is in the demo store

## How to fix each page:
1. Remove `import { ... } from '@/lib/mock-data'`
2. Add `import { useStudentData } from '@/lib/student-data'`
3. Inside the component function: `const { data } = useStudentData()`
4. Destructure what you need: `const { student, projects, knowledgeNodes, ... } = data`
5. Replace all `mockXxx` references with the destructured variables

## Run npm run build at the end — must pass clean
