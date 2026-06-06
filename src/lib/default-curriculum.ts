/**
 * Default curriculum for new users — traditional core subjects.
 * This is what new students see before Architect Bob personalizes their path.
 *
 * NOTE: The hardcoded IDs in this file (e.g. 'track-english', 'def-eng-1') are used
 * ONLY for client-side fallback display in the student-data API route. They are NOT
 * written to the database as actual record IDs. When a real curriculum is generated
 * (via /api/curriculum/generate), Prisma auto-generates all IDs.
 * Do NOT use these IDs for database inserts or foreign key references.
 */

import type { CurriculumPlan, CurriculumModule, CurriculumTrack } from '@/types'

export const defaultTracks: CurriculumTrack[] = [
  {
    id: 'track-english',
    name: 'English & Literature',
    description: 'Reading comprehension, creative writing, critical analysis, and communication',
    color: '#F97316',
    modules: ['def-eng-1', 'def-eng-2'],
  },
  {
    id: 'track-math',
    name: 'Mathematics',
    description: 'Foundations in algebra, geometry, statistics, and logical reasoning',
    color: '#8B5CF6',
    modules: ['def-math-1', 'def-math-2'],
  },
  {
    id: 'track-cs',
    name: 'Computer Science',
    description: 'Programming fundamentals, computational thinking, and digital literacy',
    color: '#3B82F6',
    modules: ['def-cs-1', 'def-cs-2'],
  },
  {
    id: 'track-science',
    name: 'Sciences',
    description: 'Biology, chemistry, physics — understanding the natural world through inquiry',
    color: '#10B981',
    modules: ['def-sci-1', 'def-sci-2'],
  },
  {
    id: 'track-econ',
    name: 'Economics & Finance',
    description: 'How money, markets, and economies work — personal finance to macro systems',
    color: '#F59E0B',
    modules: ['def-econ-1'],
  },
  {
    id: 'track-language',
    name: 'World Languages',
    description: 'Language acquisition, cultural understanding, and global communication',
    color: '#EC4899',
    modules: ['def-lang-1'],
  },
  {
    id: 'track-history',
    name: 'History & Social Studies',
    description: 'Understanding the past to navigate the present — critical thinking through history',
    color: '#6366F1',
    modules: ['def-hist-1'],
  },
]

export const defaultCoreModules: CurriculumModule[] = [
  // English
  { id: 'def-eng-1', title: 'Reading & Comprehension', description: 'Active reading strategies, text analysis, and extracting meaning from diverse sources', type: 'core-content', subject: 'General', trackId: 'track-english', status: 'not-started', progress: 0, estimatedHours: 12, prerequisites: [], skills: ['Reading comprehension', 'Text analysis', 'Vocabulary'], aiRationale: 'Foundation skill — every other subject requires strong reading ability.' },
  { id: 'def-eng-2', title: 'Written Expression', description: 'Essay structure, persuasive writing, creative writing, and clear communication', type: 'core-content', subject: 'General', trackId: 'track-english', status: 'not-started', progress: 0, estimatedHours: 15, prerequisites: ['def-eng-1'], skills: ['Essay writing', 'Creative writing', 'Argumentation', 'Grammar'], aiRationale: 'Writing is thinking made visible — critical for every field.' },

  // Math
  { id: 'def-math-1', title: 'Algebra & Functions', description: 'Variables, equations, functions, and graphing — the language of patterns', type: 'core-content', subject: 'Math', trackId: 'track-math', status: 'not-started', progress: 0, estimatedHours: 18, prerequisites: [], skills: ['Algebra', 'Functions', 'Graphing', 'Problem solving'], aiRationale: 'Math fluency unlocks CS, science, economics, and engineering.' },
  { id: 'def-math-2', title: 'Statistics & Probability', description: 'Data literacy, statistical reasoning, and understanding uncertainty', type: 'core-content', subject: 'Math', trackId: 'track-math', status: 'not-started', progress: 0, estimatedHours: 12, prerequisites: ['def-math-1'], skills: ['Statistics', 'Data analysis', 'Probability', 'Critical thinking'], aiRationale: 'The most practically useful branch of math for everyday decision-making.' },

  // CS
  { id: 'def-cs-1', title: 'Programming Fundamentals', description: 'Variables, loops, functions, and basic problem-solving through code', type: 'core-content', subject: 'CS', trackId: 'track-cs', status: 'not-started', progress: 0, estimatedHours: 20, prerequisites: [], skills: ['Python', 'Logic', 'Debugging', 'Computational thinking'], aiRationale: 'Code is the new literacy — essential regardless of career path.' },
  { id: 'def-cs-2', title: 'Digital Literacy & Tools', description: 'Spreadsheets, presentations, research skills, and online collaboration', type: 'core-content', subject: 'CS', trackId: 'track-cs', status: 'not-started', progress: 0, estimatedHours: 8, prerequisites: [], skills: ['Spreadsheets', 'Presentations', 'Research', 'Collaboration tools'], aiRationale: 'Practical digital skills needed for every modern profession.' },

  // Sciences
  { id: 'def-sci-1', title: 'Scientific Method & Inquiry', description: 'Hypothesis, experimentation, observation, and evidence-based reasoning', type: 'core-content', subject: 'General', trackId: 'track-science', status: 'not-started', progress: 0, estimatedHours: 10, prerequisites: [], skills: ['Scientific method', 'Observation', 'Experimentation', 'Critical analysis'], aiRationale: 'The foundation of all scientific thinking — how to ask and answer questions.' },
  { id: 'def-sci-2', title: 'Earth & Life Sciences Overview', description: 'Biology, ecology, chemistry basics, and understanding our physical world', type: 'core-content', subject: 'General', trackId: 'track-science', status: 'not-started', progress: 0, estimatedHours: 15, prerequisites: ['def-sci-1'], skills: ['Biology basics', 'Chemistry basics', 'Ecology', 'Systems thinking'], aiRationale: 'Broad scientific literacy for informed citizenship and future specialization.' },

  // Economics
  { id: 'def-econ-1', title: 'Economics & Personal Finance', description: 'Supply/demand, markets, budgeting, saving, and understanding economic systems', type: 'core-content', subject: 'Finance', trackId: 'track-econ', status: 'not-started', progress: 0, estimatedHours: 12, prerequisites: [], skills: ['Personal finance', 'Economic thinking', 'Budgeting', 'Market basics'], aiRationale: 'Financial literacy is life literacy — everyone needs this.' },

  // Language
  { id: 'def-lang-1', title: 'Language Foundations', description: 'Choose a language to explore — basics of grammar, vocabulary, and cultural context', type: 'core-content', subject: 'General', trackId: 'track-language', status: 'not-started', progress: 0, estimatedHours: 20, prerequisites: [], skills: ['Language basics', 'Cultural awareness', 'Communication', 'Listening'], aiRationale: 'A second language opens doors to new cultures and ways of thinking.' },

  // History
  { id: 'def-hist-1', title: 'World History & Critical Thinking', description: 'Major civilizations, turning points, and learning to analyze cause and effect', type: 'core-content', subject: 'General', trackId: 'track-history', status: 'not-started', progress: 0, estimatedHours: 14, prerequisites: [], skills: ['Historical analysis', 'Cause and effect', 'Primary sources', 'Critical thinking'], aiRationale: 'Understanding history builds empathy and better decision-making.' },
]

export const defaultProjectModules: CurriculumModule[] = []

export function createDefaultCurriculum(studentId: string): CurriculumPlan {
  return {
    id: `curriculum-${studentId}`,
    studentId,
    generatedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    version: 1,
    profileSummary: 'New student — exploring core subjects. Chat with Architect Bob to personalize your curriculum based on your interests, strengths, and goals.',
    primaryStrengths: [],
    primaryInterests: [],
    learningStyle: 'Not yet assessed',
    personalityTraits: [],
    tracks: defaultTracks,
    projectModules: defaultProjectModules,
    coreModules: defaultCoreModules,
  }
}
