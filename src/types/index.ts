export type NodeStatus = "completed" | "in-progress" | "available" | "locked";
export type Subject = "CS" | "Math" | "Psychology" | "Finance" | "General";
export type LearningStage =
  | "motivation"
  | "review"
  | "self-guided"
  | "expert-feedback";

export interface KnowledgeNode {
  id: string;
  label: string;
  subject: Subject;
  status: NodeStatus;
  description: string;
  estimatedHours: number;
  resources: Resource[];
  prerequisites: string[];
  x?: number;
  y?: number;
}

export interface Resource {
  title: string;
  type: "video" | "article" | "exercise" | "project";
  url?: string;
  duration?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  timestamp: Date;
  messages: ChatMessage[];
}

export interface SubjectProgress {
  subject: Subject;
  completed: number;
  total: number;
  color: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  earnedAt?: Date;
  locked: boolean;
}

export interface ActivityItem {
  id: string;
  type: "concept" | "chat" | "project" | "achievement" | "streak";
  description: string;
  timestamp: Date;
  subject?: Subject;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  subject: Subject;
  status: "planning" | "active" | "completed" | "paused";
  progress: number;
  dueDate?: Date;
  tags: string[];
}

export interface StudentProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  xp: number;
  level: number;
  streak: number;
  stage: LearningStage;
  joinedAt: Date;
}

export interface XPDataPoint {
  date: string;
  xp: number;
  dailyXP: number;
}

export interface SubjectMasteryPoint {
  date: string;
  CS: number;
  Math: number;
  Psychology: number;
  Finance: number;
  General: number;
}

export interface SessionDataPoint {
  date: string;
  minutes: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface ProjectTask {
  id: string;
  title: string;
  completed: boolean;
  order: number;
}

export interface ProjectMilestone {
  id: string;
  title: string;
  date: Date;
  completed: boolean;
}

export interface Assignment {
  id: string;
  title: string;
  subject: Subject;
  projectId?: string;
  description: string;
  status: "not-started" | "in-progress" | "completed";
  dueDate?: string;
  competencies: string[];
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  type: "pdf" | "markdown" | "txt" | "google-doc" | "google-slides" | "google-sheets";
  url?: string;
  size?: number;
  addedAt: string;
  isLinked: boolean;
}

// ── Curriculum Engine ──────────────────────────────────────

export interface StudentInsight {
  id: string;
  studentId: string;
  type: "personality" | "interest" | "strength" | "weakness" | "preference" | "aspiration" | "breakthrough" | "struggle" | "style";
  content: string;
  confidence: number;
  source: string;
  createdAt: string;
}

export interface CurriculumModule {
  id: string;
  title: string;
  description: string;
  type: "project" | "core-content";
  subject: string;
  trackId: string;
  status: "not-started" | "in-progress" | "completed";
  progress: number;
  estimatedHours: number;
  prerequisites: string[];
  skills: string[];
  aiRationale: string;
}

export interface CurriculumTrack {
  id: string;
  name: string;
  description: string;
  color: string;
  modules: string[];
  type?: string;
}

export interface CurriculumPlan {
  id: string;
  studentId: string;
  generatedAt: string;
  lastUpdatedAt: string;
  version: number;
  profileSummary: string;
  primaryStrengths: string[];
  primaryInterests: string[];
  learningStyle: string;
  personalityTraits: string[];
  tracks: CurriculumTrack[];
  projectModules: CurriculumModule[];
  coreModules: CurriculumModule[];
  lockedAt?: string | null;
}

// ── Subject Work Types ─────────────────────────────────────

// Content chapter within a subject
export interface ContentChapter {
  id: string;
  trackId: string; // maps to CurriculumTrack.id
  title: string;
  description: string;
  order: number;
  status: "not-started" | "in-progress" | "completed";
  content: string; // markdown
  estimatedMinutes: number;
  keyTopics: string[];
  sessionConvId?: string | null;
}

// Subject syllabus (wraps chapters + metadata)
export interface SubjectSyllabus {
  trackId: string;
  title: string;
  description: string;
  chapters: ContentChapter[];
}

// Homework assignment
export interface Homework {
  id: string;
  trackId: string;
  chapterId?: string; // optional link to content chapter
  title: string;
  description: string;
  instructions: string; // markdown with detailed instructions
  status: "not-started" | "in-progress" | "completed";
  dueDate?: string;
  competencies: string[];
  estimatedMinutes: number;
}

// AI-generated quiz
export interface Quiz {
  id: string;
  trackId: string;
  chapterId?: string;
  title: string;
  description: string;
  status: "not-started" | "in-progress" | "completed";
  questions: QuizQuestion[];
  score?: number;
  totalPoints: number;
  completedAt?: string;
  timeLimit?: number; // minutes
}

export interface QuizQuestion {
  id: string;
  question: string;
  type: "multiple-choice" | "short-answer" | "true-false";
  options?: string[];
  correctAnswer?: string; // for MC and TF
  explanation: string;
  points: number;
}

// Student project (creative, student-proposed)
export interface SubjectProject {
  id: string;
  trackId: string;
  title: string;
  description: string;
  proposal: string; // student's written proposal
  status: "proposal" | "approved" | "in-progress" | "completed" | "needs-revision";
  progress: number;
  tasks: ProjectTask[];
  milestones: ProjectMilestone[];
  coverageMap: string[]; // which chapters/topics this project covers
  mentorFeedback?: string;
}
