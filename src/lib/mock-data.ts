import type {
  KnowledgeNode,
  Conversation,
  SubjectProgress,
  Achievement,
  ActivityItem,
  Project,
  StudentProfile,
  XPDataPoint,
  SubjectMasteryPoint,
  SessionDataPoint,
  HeatmapDay,
  ProjectTask,
  ProjectMilestone,
  Assignment,
  ProjectFile,
} from "@/types";

export const mockStudent: StudentProfile = {
  id: "student-1",
  name: "Alex Chen",
  email: "alex.chen@example.com",
  avatar: undefined,
  xp: 3240,
  level: 12,
  streak: 14,
  stage: "self-guided",
  joinedAt: new Date("2024-09-01"),
};

export const mockKnowledgeNodes: KnowledgeNode[] = [
  // CS Fundamentals
  {
    id: "cs-logic",
    label: "Logic & Proofs",
    subject: "CS",
    status: "completed",
    description: "Boolean logic, propositional calculus, proof techniques",
    estimatedHours: 8,
    prerequisites: [],
    resources: [
      { title: "Introduction to Logic", type: "article", duration: "2h" },
      { title: "Proof Practice Set", type: "exercise", duration: "3h" },
    ],
  },
  {
    id: "cs-algorithms",
    label: "Algorithms",
    subject: "CS",
    status: "in-progress",
    description: "Sorting, searching, graph algorithms, complexity analysis",
    estimatedHours: 20,
    prerequisites: ["cs-logic", "math-discrete"],
    resources: [
      { title: "Introduction to Algorithms (CLRS)", type: "article", duration: "40h" },
      { title: "Algorithm Visualizer", type: "exercise", duration: "5h" },
    ],
  },
  {
    id: "cs-data-structures",
    label: "Data Structures",
    subject: "CS",
    status: "completed",
    description: "Arrays, linked lists, trees, graphs, hash tables",
    estimatedHours: 15,
    prerequisites: ["cs-logic"],
    resources: [
      { title: "Data Structures in Python", type: "video", duration: "6h" },
      { title: "LeetCode Practice", type: "exercise", duration: "10h" },
    ],
  },
  {
    id: "cs-oop",
    label: "OOP Principles",
    subject: "CS",
    status: "completed",
    description: "Classes, inheritance, polymorphism, encapsulation, SOLID",
    estimatedHours: 10,
    prerequisites: ["cs-logic"],
    resources: [
      { title: "Clean Code", type: "article", duration: "8h" },
      { title: "Design Patterns", type: "exercise", duration: "6h" },
    ],
  },
  {
    id: "cs-systems",
    label: "Systems Programming",
    subject: "CS",
    status: "available",
    description: "Memory management, concurrency, OS primitives",
    estimatedHours: 25,
    prerequisites: ["cs-algorithms", "cs-data-structures"],
    resources: [
      { title: "CS:APP", type: "article", duration: "30h" },
      { title: "Build Your Own Shell", type: "project", duration: "10h" },
    ],
  },
  {
    id: "cs-networking",
    label: "Computer Networking",
    subject: "CS",
    status: "available",
    description: "TCP/IP, HTTP, DNS, network protocols, sockets",
    estimatedHours: 18,
    prerequisites: ["cs-systems"],
    resources: [
      { title: "Computer Networking: A Top-Down Approach", type: "article", duration: "20h" },
      { title: "Build a Web Server", type: "project", duration: "8h" },
    ],
  },
  {
    id: "cs-ml",
    label: "Machine Learning",
    subject: "CS",
    status: "locked",
    description: "Supervised/unsupervised learning, neural networks, evaluation",
    estimatedHours: 30,
    prerequisites: ["math-linear-algebra", "math-probability", "cs-algorithms"],
    resources: [
      { title: "fast.ai Course", type: "video", duration: "20h" },
      { title: "Kaggle Competitions", type: "project", duration: "15h" },
    ],
  },
  {
    id: "cs-databases",
    label: "Databases",
    subject: "CS",
    status: "in-progress",
    description: "SQL, NoSQL, indexing, transactions, query optimization",
    estimatedHours: 14,
    prerequisites: ["cs-data-structures"],
    resources: [
      { title: "Use The Index, Luke", type: "article", duration: "4h" },
      { title: "Build a Database", type: "project", duration: "12h" },
    ],
  },
  {
    id: "cs-web",
    label: "Web Development",
    subject: "CS",
    status: "completed",
    description: "HTML, CSS, JavaScript, React, APIs, deployment",
    estimatedHours: 20,
    prerequisites: ["cs-oop"],
    resources: [
      { title: "The Odin Project", type: "article", duration: "50h" },
      { title: "Full Stack Project", type: "project", duration: "20h" },
    ],
  },
  {
    id: "cs-security",
    label: "Cybersecurity",
    subject: "CS",
    status: "locked",
    description: "Cryptography, authentication, common vulnerabilities, secure design",
    estimatedHours: 20,
    prerequisites: ["cs-networking", "cs-systems"],
    resources: [
      { title: "Cryptography I (Coursera)", type: "video", duration: "15h" },
      { title: "PicoCTF Challenges", type: "exercise", duration: "10h" },
    ],
  },

  // Math
  {
    id: "math-discrete",
    label: "Discrete Math",
    subject: "Math",
    status: "completed",
    description: "Sets, relations, combinatorics, graph theory, number theory",
    estimatedHours: 15,
    prerequisites: ["cs-logic"],
    resources: [
      { title: "Discrete Mathematics and its Applications", type: "article", duration: "20h" },
    ],
  },
  {
    id: "math-linear-algebra",
    label: "Linear Algebra",
    subject: "Math",
    status: "in-progress",
    description: "Vectors, matrices, eigenvalues, linear transformations",
    estimatedHours: 20,
    prerequisites: ["math-discrete"],
    resources: [
      { title: "3Blue1Brown Linear Algebra", type: "video", duration: "5h" },
      { title: "Gilbert Strang Lectures", type: "video", duration: "15h" },
    ],
  },
  {
    id: "math-calculus",
    label: "Calculus",
    subject: "Math",
    status: "completed",
    description: "Limits, derivatives, integrals, multivariable calculus",
    estimatedHours: 25,
    prerequisites: [],
    resources: [
      { title: "MIT 18.01 OpenCourseWare", type: "video", duration: "25h" },
      { title: "Khan Academy Calculus", type: "exercise", duration: "10h" },
    ],
  },
  {
    id: "math-probability",
    label: "Probability & Statistics",
    subject: "Math",
    status: "available",
    description: "Random variables, distributions, inference, Bayesian reasoning",
    estimatedHours: 18,
    prerequisites: ["math-calculus", "math-discrete"],
    resources: [
      { title: "Think Stats", type: "article", duration: "8h" },
      { title: "Statistical Inference", type: "article", duration: "10h" },
    ],
  },
  {
    id: "math-optimization",
    label: "Optimization",
    subject: "Math",
    status: "locked",
    description: "Gradient descent, convex optimization, dynamic programming",
    estimatedHours: 20,
    prerequisites: ["math-linear-algebra", "math-calculus"],
    resources: [
      { title: "Convex Optimization (Boyd)", type: "article", duration: "20h" },
    ],
  },
  {
    id: "math-info-theory",
    label: "Information Theory",
    subject: "Math",
    status: "locked",
    description: "Entropy, coding theory, compression, mutual information",
    estimatedHours: 15,
    prerequisites: ["math-probability"],
    resources: [
      { title: "Elements of Information Theory", type: "article", duration: "15h" },
    ],
  },

  // Psychology
  {
    id: "psych-cognitive",
    label: "Cognitive Psychology",
    subject: "Psychology",
    status: "completed",
    description: "Memory, attention, perception, decision-making, mental models",
    estimatedHours: 12,
    prerequisites: [],
    resources: [
      { title: "Thinking, Fast and Slow", type: "article", duration: "8h" },
      { title: "How the Mind Works", type: "article", duration: "10h" },
    ],
  },
  {
    id: "psych-learning",
    label: "Learning Science",
    subject: "Psychology",
    status: "in-progress",
    description: "Spaced repetition, interleaving, retrieval practice, growth mindset",
    estimatedHours: 8,
    prerequisites: ["psych-cognitive"],
    resources: [
      { title: "Make It Stick", type: "article", duration: "6h" },
      { title: "Learning How to Learn (Coursera)", type: "video", duration: "4h" },
    ],
  },
  {
    id: "psych-motivation",
    label: "Motivation & Behavior",
    subject: "Psychology",
    status: "available",
    description: "Intrinsic vs extrinsic motivation, flow states, habit formation",
    estimatedHours: 8,
    prerequisites: ["psych-cognitive"],
    resources: [
      { title: "Drive by Daniel Pink", type: "article", duration: "5h" },
      { title: "The Power of Habit", type: "article", duration: "5h" },
    ],
  },
  {
    id: "psych-social",
    label: "Social Psychology",
    subject: "Psychology",
    status: "locked",
    description: "Group dynamics, persuasion, conformity, social influence",
    estimatedHours: 10,
    prerequisites: ["psych-cognitive", "psych-motivation"],
    resources: [
      { title: "Influence by Cialdini", type: "article", duration: "6h" },
      { title: "The Social Animal", type: "article", duration: "8h" },
    ],
  },
  {
    id: "psych-ux",
    label: "UX Psychology",
    subject: "Psychology",
    status: "available",
    description: "Human-computer interaction, cognitive load, UX design principles",
    estimatedHours: 10,
    prerequisites: ["psych-cognitive", "cs-web"],
    resources: [
      { title: "Don't Make Me Think", type: "article", duration: "4h" },
      { title: "The Design of Everyday Things", type: "article", duration: "6h" },
    ],
  },

  // Finance
  {
    id: "fin-fundamentals",
    label: "Finance Fundamentals",
    subject: "Finance",
    status: "completed",
    description: "Time value of money, compounding, basic financial statements",
    estimatedHours: 10,
    prerequisites: ["math-calculus"],
    resources: [
      { title: "Khan Academy Finance", type: "video", duration: "6h" },
      { title: "The Intelligent Investor (intro)", type: "article", duration: "4h" },
    ],
  },
  {
    id: "fin-accounting",
    label: "Accounting Basics",
    subject: "Finance",
    status: "completed",
    description: "Balance sheets, income statements, cash flow, financial ratios",
    estimatedHours: 8,
    prerequisites: ["fin-fundamentals"],
    resources: [
      { title: "Financial Accounting (MIT OCW)", type: "video", duration: "8h" },
    ],
  },
  {
    id: "fin-investing",
    label: "Investing & Markets",
    subject: "Finance",
    status: "in-progress",
    description: "Equities, bonds, portfolio theory, risk management, ETFs",
    estimatedHours: 15,
    prerequisites: ["fin-fundamentals", "math-probability"],
    resources: [
      { title: "A Random Walk Down Wall Street", type: "article", duration: "8h" },
      { title: "Portfolio Simulation", type: "project", duration: "5h" },
    ],
  },
  {
    id: "fin-startup",
    label: "Startup Finance",
    subject: "Finance",
    status: "available",
    description: "VC funding, cap tables, unit economics, runway, burn rate",
    estimatedHours: 10,
    prerequisites: ["fin-accounting", "fin-fundamentals"],
    resources: [
      { title: "Venture Deals", type: "article", duration: "6h" },
      { title: "YC Startup School Finance", type: "video", duration: "4h" },
    ],
  },
  {
    id: "fin-quant",
    label: "Quantitative Finance",
    subject: "Finance",
    status: "locked",
    description: "Derivatives, stochastic calculus, Black-Scholes, risk models",
    estimatedHours: 25,
    prerequisites: ["fin-investing", "math-probability", "math-calculus"],
    resources: [
      { title: "Options, Futures, and Other Derivatives", type: "article", duration: "20h" },
    ],
  },
  {
    id: "fin-crypto",
    label: "Blockchain & Crypto",
    subject: "Finance",
    status: "available",
    description: "Bitcoin, Ethereum, smart contracts, DeFi, tokenomics",
    estimatedHours: 12,
    prerequisites: ["cs-security", "fin-fundamentals"],
    resources: [
      { title: "Bitcoin Whitepaper", type: "article", duration: "2h" },
      { title: "Build a Simple Blockchain", type: "project", duration: "8h" },
    ],
  },

  // General / Interdisciplinary
  {
    id: "gen-systems",
    label: "Systems Thinking",
    subject: "General",
    status: "in-progress",
    description: "Feedback loops, emergence, complexity, mental models",
    estimatedHours: 10,
    prerequisites: ["psych-cognitive"],
    resources: [
      { title: "Thinking in Systems", type: "article", duration: "6h" },
      { title: "The Fifth Discipline", type: "article", duration: "8h" },
    ],
  },
  {
    id: "gen-writing",
    label: "Technical Writing",
    subject: "General",
    status: "completed",
    description: "Clear communication, documentation, technical essays",
    estimatedHours: 8,
    prerequisites: [],
    resources: [
      { title: "On Writing Well", type: "article", duration: "5h" },
      { title: "Google Technical Writing Course", type: "exercise", duration: "4h" },
    ],
  },
  {
    id: "gen-product",
    label: "Product Thinking",
    subject: "General",
    status: "available",
    description: "User research, product-market fit, roadmapping, metrics",
    estimatedHours: 12,
    prerequisites: ["psych-ux", "gen-systems"],
    resources: [
      { title: "Inspired by Marty Cagan", type: "article", duration: "6h" },
      { title: "Product Strategy Frameworks", type: "exercise", duration: "4h" },
    ],
  },
  {
    id: "gen-research",
    label: "Research Methods",
    subject: "General",
    status: "available",
    description: "Scientific method, experiment design, literature review, citations",
    estimatedHours: 10,
    prerequisites: ["math-probability", "gen-writing"],
    resources: [
      { title: "The Craft of Research", type: "article", duration: "6h" },
      { title: "How to Read a Paper", type: "article", duration: "2h" },
    ],
  },
];

export const mockSubjectProgress: SubjectProgress[] = [
  { subject: "CS", completed: 4, total: 10, color: "#3B82F6" },
  { subject: "Math", completed: 2, total: 6, color: "#8B5CF6" },
  { subject: "Psychology", completed: 1, total: 5, color: "#EC4899" },
  { subject: "Finance", completed: 2, total: 7, color: "#F59E0B" },
  { subject: "General", completed: 1, total: 4, color: "#10B981" },
];

export const mockAchievements: Achievement[] = [
  {
    id: "first-concept",
    title: "First Steps",
    description: "Complete your first concept",
    icon: "🚀",
    earnedAt: new Date("2024-09-05"),
    locked: false,
  },
  {
    id: "week-streak",
    title: "Week Warrior",
    description: "Maintain a 7-day learning streak",
    icon: "🔥",
    earnedAt: new Date("2024-10-01"),
    locked: false,
  },
  {
    id: "cross-domain",
    title: "Polymath",
    description: "Complete concepts in 3 different subjects",
    icon: "🧠",
    earnedAt: new Date("2024-11-15"),
    locked: false,
  },
  {
    id: "two-week-streak",
    title: "Two Week Titan",
    description: "Maintain a 14-day learning streak",
    icon: "⚡",
    earnedAt: new Date("2025-01-10"),
    locked: false,
  },
  {
    id: "first-project",
    title: "Builder",
    description: "Complete your first project",
    icon: "🔨",
    earnedAt: new Date("2024-12-01"),
    locked: false,
  },
  {
    id: "month-streak",
    title: "Monthly Master",
    description: "Maintain a 30-day learning streak",
    icon: "🏆",
    locked: true,
  },
  {
    id: "ten-concepts",
    title: "Deep Diver",
    description: "Complete 10 concepts",
    icon: "💎",
    locked: true,
  },
];

export const mockActivity: ActivityItem[] = [
  {
    id: "act-1",
    type: "concept",
    description: "Completed Linear Algebra checkpoint: Eigenvalues",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    subject: "Math",
  },
  {
    id: "act-2",
    type: "chat",
    description: "Had a 45-min session with Architect Bob on system design",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    subject: "CS",
  },
  {
    id: "act-3",
    type: "project",
    description: "Updated Stock Portfolio Analyzer project",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
    subject: "Finance",
  },
  {
    id: "act-4",
    type: "achievement",
    description: "Earned achievement: Two Week Titan 🔥",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
  },
  {
    id: "act-5",
    type: "concept",
    description: "Started Databases module: SQL fundamentals",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 26),
    subject: "CS",
  },
  {
    id: "act-6",
    type: "concept",
    description: "Completed UX Psychology reading",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48),
    subject: "Psychology",
  },
];

export const mockProjects: Project[] = [
  {
    id: "proj-1",
    title: "Stock Portfolio Analyzer",
    description:
      "A Python app that fetches real-time stock data, calculates portfolio metrics, and visualizes performance using matplotlib.",
    subject: "Finance",
    status: "active",
    progress: 65,
    dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    tags: ["Python", "Finance", "Data Viz"],
  },
  {
    id: "proj-2",
    title: "Algorithm Visualizer",
    description:
      "Interactive web app that visualizes sorting and graph algorithms in real-time, helping teach concepts to peers.",
    subject: "CS",
    status: "active",
    progress: 40,
    dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    tags: ["React", "TypeScript", "Algorithms"],
  },
  {
    id: "proj-3",
    title: "Spaced Repetition Study App",
    description:
      "A Anki-like flashcard system with SM-2 algorithm, analytics dashboard, and export features.",
    subject: "Psychology",
    status: "planning",
    progress: 10,
    tags: ["Learning Science", "Next.js", "Psychology"],
  },
  {
    id: "proj-4",
    title: "Personal Finance Dashboard",
    description:
      "Full-stack app integrating with bank APIs to track spending, savings goals, and investment performance.",
    subject: "Finance",
    status: "completed",
    progress: 100,
    tags: ["Finance", "React", "Node.js"],
  },
];

// ────────────────────────────────────────────────────────
// Project detail data
// ────────────────────────────────────────────────────────

export const mockProjectTasks: Record<string, ProjectTask[]> = {
  "proj-1": [
    { id: "t1", title: "Set up Python project structure", completed: true, order: 0 },
    { id: "t2", title: "Integrate Alpha Vantage API for stock data", completed: true, order: 1 },
    { id: "t3", title: "Build portfolio metrics calculator (Sharpe ratio, beta)", completed: true, order: 2 },
    { id: "t4", title: "Create matplotlib visualizations for performance", completed: false, order: 3 },
    { id: "t5", title: "Add portfolio comparison vs S&P 500", completed: false, order: 4 },
    { id: "t6", title: "Write unit tests for metrics", completed: false, order: 5 },
    { id: "t7", title: "Deploy to Heroku with README", completed: false, order: 6 },
  ],
  "proj-2": [
    { id: "t8", title: "Design UI/UX wireframes for algorithm visualizer", completed: true, order: 0 },
    { id: "t9", title: "Implement bubble sort and selection sort animations", completed: true, order: 1 },
    { id: "t10", title: "Add merge sort and quick sort", completed: false, order: 2 },
    { id: "t11", title: "Build graph BFS/DFS visualizations", completed: false, order: 3 },
    { id: "t12", title: "Add speed controls and step-through mode", completed: false, order: 4 },
    { id: "t13", title: "Write tutorial content for each algorithm", completed: false, order: 5 },
  ],
  "proj-3": [
    { id: "t14", title: "Research SM-2 spaced repetition algorithm", completed: true, order: 0 },
    { id: "t15", title: "Design database schema for cards and reviews", completed: false, order: 1 },
    { id: "t16", title: "Build card creation UI", completed: false, order: 2 },
    { id: "t17", title: "Implement review session with SM-2 scheduling", completed: false, order: 3 },
    { id: "t18", title: "Add analytics dashboard for retention rates", completed: false, order: 4 },
  ],
  "proj-4": [
    { id: "t19", title: "Set up Plaid API integration", completed: true, order: 0 },
    { id: "t20", title: "Build transaction categorization engine", completed: true, order: 1 },
    { id: "t21", title: "Create spending breakdown charts", completed: true, order: 2 },
    { id: "t22", title: "Add savings goal tracker", completed: true, order: 3 },
    { id: "t23", title: "Build investment performance view", completed: true, order: 4 },
    { id: "t24", title: "Add export to CSV feature", completed: true, order: 5 },
  ],
}

export const mockProjectMilestones: Record<string, ProjectMilestone[]> = {
  "proj-1": [
    { id: "m1", title: "Project Kickoff", date: new Date("2026-02-01"), completed: true },
    { id: "m2", title: "Data Layer Complete", date: new Date("2026-02-15"), completed: true },
    { id: "m3", title: "Core Metrics Done", date: new Date("2026-03-01"), completed: true },
    { id: "m4", title: "Visualizations", date: new Date("2026-03-20"), completed: false },
    { id: "m5", title: "Final Submission", date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), completed: false },
  ],
  "proj-2": [
    { id: "m6", title: "Design Phase", date: new Date("2026-02-10"), completed: true },
    { id: "m7", title: "Basic Sorts", date: new Date("2026-03-01"), completed: true },
    { id: "m8", title: "Advanced Algorithms", date: new Date("2026-03-25"), completed: false },
    { id: "m9", title: "Graph Algorithms", date: new Date("2026-04-05"), completed: false },
    { id: "m10", title: "Launch", date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14), completed: false },
  ],
  "proj-3": [
    { id: "m11", title: "Research Complete", date: new Date("2026-03-10"), completed: true },
    { id: "m12", title: "MVP Build", date: new Date("2026-04-15"), completed: false },
    { id: "m13", title: "Beta Testing", date: new Date("2026-05-01"), completed: false },
  ],
  "proj-4": [
    { id: "m14", title: "API Integration", date: new Date("2025-10-01"), completed: true },
    { id: "m15", title: "Core Features", date: new Date("2025-11-01"), completed: true },
    { id: "m16", title: "Polish & Deploy", date: new Date("2025-12-01"), completed: true },
    { id: "m17", title: "Project Complete", date: new Date("2025-12-15"), completed: true },
  ],
}

// ────────────────────────────────────────────────────────
// Time-series data (90 days ending 2026-03-25)
// ────────────────────────────────────────────────────────

function dateStr(daysAgo: number): string {
  const d = new Date("2026-03-25")
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split("T")[0]
}

// Generate realistic XP progression
const xpCurve: XPDataPoint[] = (() => {
  const dailyXP = [
    0,20,45,0,60,80,35,0,55,90,
    40,0,75,50,30,85,65,0,45,70,
    90,35,0,60,80,50,40,75,0,85,
    55,30,70,45,0,90,60,80,35,50,
    0,65,45,85,70,30,55,0,90,80,
    40,60,75,0,50,85,35,70,45,90,
    0,60,80,55,30,75,85,0,45,70,
    90,35,50,65,0,80,60,40,75,85,
    0,55,70,90,45,30,80,65,0,85,
  ]
  let cumulative = 3240 - dailyXP.reduce((a, b) => a + b, 0)
  return dailyXP.map((dx, i) => {
    cumulative += dx
    return { date: dateStr(dailyXP.length - 1 - i), xp: cumulative, dailyXP: dx }
  })
})()

export const mockXPData: XPDataPoint[] = xpCurve

export const mockSubjectMastery: SubjectMasteryPoint[] = (() => {
  // Build a progression over 90 days
  const points: SubjectMasteryPoint[] = []
  const subjectSnaps = [
    { CS: 15, Math: 10, Psychology: 5, Finance: 10, General: 5 },
    { CS: 20, Math: 15, Psychology: 10, Finance: 15, General: 10 },
    { CS: 25, Math: 20, Psychology: 15, Finance: 20, General: 15 },
    { CS: 30, Math: 25, Psychology: 15, Finance: 25, General: 20 },
    { CS: 35, Math: 30, Psychology: 20, Finance: 30, General: 20 },
    { CS: 40, Math: 33, Psychology: 20, Finance: 29, General: 25 },
  ]
  const totalDays = 89
  for (let i = 0; i <= totalDays; i++) {
    const t = i / totalDays
    const seg = t * (subjectSnaps.length - 1)
    const lo = Math.floor(seg)
    const hi = Math.min(lo + 1, subjectSnaps.length - 1)
    const frac = seg - lo
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * frac)
    points.push({
      date: dateStr(totalDays - i),
      CS: lerp(subjectSnaps[lo].CS, subjectSnaps[hi].CS),
      Math: lerp(subjectSnaps[lo].Math, subjectSnaps[hi].Math),
      Psychology: lerp(subjectSnaps[lo].Psychology, subjectSnaps[hi].Psychology),
      Finance: lerp(subjectSnaps[lo].Finance, subjectSnaps[hi].Finance),
      General: lerp(subjectSnaps[lo].General, subjectSnaps[hi].General),
    })
  }
  return points
})()

export const mockSessionData: SessionDataPoint[] = (() => {
  const sessions = [
    0,45,90,0,60,120,75,0,55,100,
    80,0,45,90,30,110,70,0,60,85,
    120,50,0,75,95,60,45,90,0,100,
    65,40,80,50,0,120,75,95,45,60,
    0,85,55,100,80,35,65,0,110,95,
    50,70,90,0,60,100,45,85,55,120,
    0,75,95,65,40,90,100,0,55,85,
    110,45,60,80,0,95,75,50,90,100,
    0,65,85,120,55,40,95,80,0,100,
  ]
  return sessions.map((minutes, i) => ({
    date: dateStr(sessions.length - 1 - i),
    minutes,
  }))
})()

export const mockHeatmapData: HeatmapDay[] = (() => {
  const intensities = [
    0,2,3,0,2,4,3,0,2,3,
    2,0,3,2,1,4,3,0,2,3,
    4,2,0,3,4,2,2,3,0,4,
    3,1,3,2,0,4,3,4,2,2,
    0,3,2,4,3,1,3,0,4,4,
    2,3,3,0,2,4,2,3,2,4,
    0,3,4,3,1,3,4,0,2,3,
    4,2,2,3,0,4,3,2,3,4,
    0,3,3,4,2,1,4,3,0,4,
  ]
  return intensities.map((count, i) => ({
    date: dateStr(intensities.length - 1 - i),
    count,
  }))
})()

export const mockConversations: Conversation[] = [
  {
    id: "conv-1",
    title: "System Design Interview Prep",
    preview: "Let's talk about how to design a URL shortener...",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "I have a system design interview coming up. Can we practice designing a URL shortener?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
      },
      {
        id: "msg-2",
        role: "assistant",
        content: `Great timing to practice! Before I show you how I'd approach it, let me ask you some questions first — this mirrors what real interviewers want to see.\n\n**Start with clarifying questions:**\n\n1. What's the scale? How many URLs per day? Reads vs writes ratio?\n2. Should shortened URLs be permanent or have expiry?\n3. Any custom alias support needed?\n4. Geographic distribution requirements?\n\nWhat do you think the first thing you'd say to the interviewer is? Don't worry about getting it perfect — I want to see how you think, not test memorized answers.`,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2 + 5000),
      },
      {
        id: "msg-3",
        role: "user",
        content: "I'd ask about scale first — like 100M URLs per day, mostly reads.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2 + 10000),
      },
      {
        id: "msg-4",
        role: "assistant",
        content: `Perfect instinct! Scale-first is exactly right. Now let's think through the architecture together.\n\n**With 100M URLs/day:**\n- That's ~1,150 writes/second\n- If reads are 100:1 ratio → ~115,000 reads/second\n\n**What does that tell you about the storage approach?** Think about:\n- SQL vs NoSQL for this use case\n- Where would you put caching?\n- How would you generate the short code (hint: think about base62 encoding)?\n\nTake a stab at it — what's your instinct for the hash generation?`,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2 + 15000),
      },
    ],
  },
  {
    id: "conv-2",
    title: "Understanding Eigenvalues",
    preview: "What's the intuition behind eigenvalues?",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
    messages: [
      {
        id: "msg-5",
        role: "user",
        content: "I keep getting lost with eigenvalues and eigenvectors. I can do the calculations but I don't understand what they actually mean.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
      {
        id: "msg-6",
        role: "assistant",
        content: `This is one of the most common stumbling blocks in linear algebra — and it's totally valid. Knowing the calculation but not the meaning is exactly the gap we need to close.\n\nLet me ask you something first: when you multiply a matrix by a vector, what do you think is happening geometrically? What is the transformation *doing* to the vector?\n\n(There's no wrong answer — just describe it in your own words, even if it feels fuzzy.)`,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 + 5000),
      },
    ],
  },
  {
    id: "conv-3",
    title: "Career Path Discussion",
    preview: "Should I focus on ML engineering or backend?",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3),
    messages: [
      {
        id: "msg-7",
        role: "user",
        content: "I'm trying to decide between specializing in ML engineering vs becoming a backend/distributed systems engineer. Both interest me but I need to pick a direction.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3),
      },
      {
        id: "msg-8",
        role: "assistant",
        content: `This is a genuinely hard and important question — so I'm glad you're thinking about it deliberately.\n\nBefore I share any thoughts, help me understand a bit more:\n\n1. **What excites you about each?** Like specifically — is it the scale of distributed systems, or is it something about ML's ability to learn from data?\n\n2. **When you've done projects so far, which one made you lose track of time?** Your actual behavior in the past is a better signal than your preferences in the abstract.\n\n3. **What does your ideal day look like in 5 years?** (Not job title — the actual work)\n\nI have strong opinions on this, but I want to understand *your* situation first before potentially biasing you toward my perspective.`,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3 + 5000),
      },
    ],
  },
];

// ────────────────────────────────────────────────────────
// Assignments
// ────────────────────────────────────────────────────────

export const mockAssignments: Assignment[] = [
  // CS
  {
    id: "asgn-cs-1",
    title: "Implement Binary Search Tree",
    subject: "CS",
    projectId: "proj-2",
    description: "Build a BST with insert, delete, and traversal methods. Analyze time complexity.",
    status: "completed",
    dueDate: "2026-02-20",
    competencies: ["Data Structures", "Algorithm Design", "Complexity Analysis"],
  },
  {
    id: "asgn-cs-2",
    title: "Sorting Algorithm Comparison",
    subject: "CS",
    projectId: "proj-2",
    description: "Benchmark merge sort, quick sort, and heap sort on various input sizes. Write analysis report.",
    status: "in-progress",
    dueDate: "2026-03-28",
    competencies: ["Algorithms", "Performance Analysis", "Technical Writing"],
  },
  {
    id: "asgn-cs-3",
    title: "SQL Query Optimization Lab",
    subject: "CS",
    description: "Optimize 5 slow queries using indexes and query plans. Measure before/after performance.",
    status: "not-started",
    dueDate: "2026-04-05",
    competencies: ["Databases", "SQL", "Performance Optimization"],
  },
  {
    id: "asgn-cs-4",
    title: "Build a REST API with Express",
    subject: "CS",
    projectId: "proj-2",
    description: "Create a CRUD API with authentication, validation, and error handling.",
    status: "not-started",
    dueDate: "2026-04-15",
    competencies: ["Web Development", "API Design", "Node.js"],
  },

  // Math
  {
    id: "asgn-math-1",
    title: "Eigenvalue Decomposition Worksheet",
    subject: "Math",
    description: "Solve 10 eigenvalue problems and interpret each geometrically using 3Blue1Brown intuition.",
    status: "in-progress",
    dueDate: "2026-03-30",
    competencies: ["Linear Algebra", "Mathematical Intuition"],
  },
  {
    id: "asgn-math-2",
    title: "Probability Distributions Deep Dive",
    subject: "Math",
    description: "Explore normal, Poisson, and binomial distributions with real-world examples and simulations.",
    status: "not-started",
    dueDate: "2026-04-10",
    competencies: ["Probability", "Statistics", "Data Analysis"],
  },
  {
    id: "asgn-math-3",
    title: "Gradient Descent from Scratch",
    subject: "Math",
    projectId: "proj-2",
    description: "Implement gradient descent in Python, apply to linear regression, visualize convergence.",
    status: "not-started",
    dueDate: "2026-04-20",
    competencies: ["Optimization", "Calculus", "Python"],
  },

  // Psychology
  {
    id: "asgn-psych-1",
    title: "Spaced Repetition Algorithm Analysis",
    subject: "Psychology",
    projectId: "proj-3",
    description: "Research SM-2 algorithm. Write a 1-page summary explaining the psychological basis.",
    status: "completed",
    dueDate: "2026-03-01",
    competencies: ["Learning Science", "Research", "Technical Writing"],
  },
  {
    id: "asgn-psych-2",
    title: "Cognitive Load UX Audit",
    subject: "Psychology",
    description: "Evaluate 3 popular apps for cognitive load. Apply Don't Make Me Think principles.",
    status: "in-progress",
    dueDate: "2026-04-01",
    competencies: ["UX Psychology", "Cognitive Psychology", "Critical Analysis"],
  },
  {
    id: "asgn-psych-3",
    title: "Motivation Interview",
    subject: "Psychology",
    description: "Interview 2 peers about their learning motivation. Apply Drive framework by Daniel Pink.",
    status: "not-started",
    dueDate: "2026-04-12",
    competencies: ["Motivation & Behavior", "Communication", "Research Methods"],
  },

  // Finance
  {
    id: "asgn-fin-1",
    title: "Portfolio Risk Analysis",
    subject: "Finance",
    projectId: "proj-1",
    description: "Calculate Sharpe ratio, beta, and max drawdown for a sample 5-stock portfolio.",
    status: "completed",
    dueDate: "2026-02-28",
    competencies: ["Investing & Markets", "Risk Management", "Python"],
  },
  {
    id: "asgn-fin-2",
    title: "Income Statement Deep Dive",
    subject: "Finance",
    projectId: "proj-4",
    description: "Analyze Apple's last 3 annual income statements. Identify key trends and ratios.",
    status: "completed",
    dueDate: "2026-03-05",
    competencies: ["Accounting Basics", "Financial Analysis"],
  },
  {
    id: "asgn-fin-3",
    title: "Startup Cap Table Modeling",
    subject: "Finance",
    description: "Model a seed-to-Series A cap table with dilution scenarios in a spreadsheet.",
    status: "not-started",
    dueDate: "2026-04-08",
    competencies: ["Startup Finance", "Financial Modeling"],
  },

  // General
  {
    id: "asgn-gen-1",
    title: "Systems Map: EdTech Industry",
    subject: "General",
    description: "Create a causal loop diagram of the edtech industry. Identify feedback loops and leverage points.",
    status: "in-progress",
    dueDate: "2026-03-31",
    competencies: ["Systems Thinking", "Research Methods", "Visualization"],
  },
  {
    id: "asgn-gen-2",
    title: "Technical Blog Post",
    subject: "General",
    projectId: "proj-2",
    description: "Write a 800-word technical blog post explaining one algorithm from your visualizer project.",
    status: "not-started",
    dueDate: "2026-04-18",
    competencies: ["Technical Writing", "Communication"],
  },
];

// ────────────────────────────────────────────────────────
// Demo project files (for project storage UI)
// ────────────────────────────────────────────────────────

export const mockProjectFiles: Record<string, ProjectFile[]> = {
  "proj-1": [
    {
      id: "file-1",
      projectId: "proj-1",
      name: "Portfolio Analysis Notes.pdf",
      type: "pdf",
      size: 184320,
      addedAt: "2026-02-10",
      isLinked: false,
    },
    {
      id: "file-2",
      projectId: "proj-1",
      name: "Stock Data Analysis",
      type: "google-sheets",
      url: "https://docs.google.com/spreadsheets/d/example",
      addedAt: "2026-02-12",
      isLinked: true,
    },
    {
      id: "file-3",
      projectId: "proj-1",
      name: "Project Proposal.md",
      type: "markdown",
      size: 4096,
      addedAt: "2026-02-01",
      isLinked: false,
    },
  ],
  "proj-2": [
    {
      id: "file-4",
      projectId: "proj-2",
      name: "Algorithm Design Doc",
      type: "google-doc",
      url: "https://docs.google.com/document/d/example",
      addedAt: "2026-02-15",
      isLinked: true,
    },
    {
      id: "file-5",
      projectId: "proj-2",
      name: "UI Wireframes.pdf",
      type: "pdf",
      size: 2097152,
      addedAt: "2026-02-10",
      isLinked: false,
    },
  ],
  "proj-3": [
    {
      id: "file-6",
      projectId: "proj-3",
      name: "SM-2 Research Summary.md",
      type: "markdown",
      size: 8192,
      addedAt: "2026-03-05",
      isLinked: false,
    },
    {
      id: "file-7",
      projectId: "proj-3",
      name: "Project Roadmap Slides",
      type: "google-slides",
      url: "https://docs.google.com/presentation/d/example",
      addedAt: "2026-03-10",
      isLinked: true,
    },
  ],
  "proj-4": [
    {
      id: "file-8",
      projectId: "proj-4",
      name: "Final Report.pdf",
      type: "pdf",
      size: 3145728,
      addedAt: "2025-12-10",
      isLinked: false,
    },
    {
      id: "file-9",
      projectId: "proj-4",
      name: "API Documentation",
      type: "google-doc",
      url: "https://docs.google.com/document/d/example",
      addedAt: "2025-11-20",
      isLinked: true,
    },
  ],
};

// ── Curriculum Engine Demo Data ─────────────────────────────

import type { StudentInsight, CurriculumPlan, CurriculumModule, CurriculumTrack } from "@/types";

export const mockInsights: StudentInsight[] = [
  { id: "ins-1", studentId: "student-1", type: "interest", content: "Deeply fascinated by game mechanics and interactive systems", confidence: 0.9, source: "onboarding", createdAt: "2024-09-01" },
  { id: "ins-2", studentId: "student-1", type: "strength", content: "Strong logical reasoning and pattern recognition — picks up algorithms quickly", confidence: 0.85, source: "cs-algorithms-chat", createdAt: "2024-09-15" },
  { id: "ins-3", studentId: "student-1", type: "personality", content: "Visual learner who prefers building things over reading theory", confidence: 0.8, source: "onboarding", createdAt: "2024-09-01" },
  { id: "ins-4", studentId: "student-1", type: "preference", content: "Works best in short intense bursts (45-60 min) rather than long sessions", confidence: 0.7, source: "session-patterns", createdAt: "2024-10-05" },
  { id: "ins-5", studentId: "student-1", type: "aspiration", content: "Wants to build AI-powered games that adapt to players", confidence: 0.85, source: "chat-2024-10-12", createdAt: "2024-10-12" },
  { id: "ins-6", studentId: "student-1", type: "weakness", content: "Tends to skip documentation and planning — jumps straight to coding", confidence: 0.75, source: "project-review", createdAt: "2024-10-20" },
  { id: "ins-7", studentId: "student-1", type: "style", content: "Learns best through trial-and-error with immediate feedback loops", confidence: 0.8, source: "multiple-sessions", createdAt: "2024-11-01" },
  { id: "ins-8", studentId: "student-1", type: "breakthrough", content: "Had an aha moment connecting recursion to game tree search — now deeply motivated about AI", confidence: 0.9, source: "chat-2024-11-10", createdAt: "2024-11-10" },
  { id: "ins-9", studentId: "student-1", type: "interest", content: "Growing curiosity about psychology of motivation and game design", confidence: 0.7, source: "chat-2024-11-15", createdAt: "2024-11-15" },
  { id: "ins-10", studentId: "student-1", type: "strength", content: "Excellent at breaking complex problems into smaller parts", confidence: 0.8, source: "project-review", createdAt: "2024-12-01" },
];

export const mockCurriculumTracks: CurriculumTrack[] = [
  {
    id: "track-gamedev",
    name: "Game Development & Interactive Systems",
    description: "Build progressively complex games while mastering CS fundamentals, AI, and design thinking",
    color: "#3B82F6",
    modules: ["pm-1", "pm-2", "pm-3", "pm-4", "pm-5", "pm-6"],
  },
  {
    id: "track-ai",
    name: "AI & Adaptive Systems",
    description: "Explore machine learning and AI through the lens of creating intelligent, responsive systems",
    color: "#8B5CF6",
    modules: ["pm-7", "pm-8"],
  },
  {
    id: "track-core",
    name: "Core Foundations",
    description: "Essential math, writing, history, and science — delivered efficiently so you can focus on building",
    color: "#10B981",
    modules: ["cm-1", "cm-2", "cm-3", "cm-4", "cm-5"],
  },
];

export const mockProjectModules: CurriculumModule[] = [
  {
    id: "pm-1", title: "Build a Text Adventure Game", description: "Create an interactive fiction game with branching narratives, inventory system, and dynamic storytelling", type: "project", subject: "CS", trackId: "track-gamedev", status: "completed", progress: 100, estimatedHours: 20, prerequisites: [], skills: ["Python basics", "Control flow", "Data structures", "Narrative design"], aiRationale: "Alex learns best by building. A text adventure introduces core CS concepts through something they're excited about — game narratives.",
  },
  {
    id: "pm-2", title: "2D Puzzle Platformer", description: "Design and code a puzzle platformer with physics, level design, and player progression mechanics", type: "project", subject: "CS", trackId: "track-gamedev", status: "completed", progress: 100, estimatedHours: 35, prerequisites: ["pm-1"], skills: ["OOP", "Game loops", "Physics simulation", "Level design", "Sprite animation"], aiRationale: "Building on text adventure success. Alex showed strong spatial reasoning — a 2D platformer channels that into visual, physics-based problem solving.",
  },
  {
    id: "pm-3", title: "Multiplayer Card Game", description: "Build an online card game with matchmaking, game state sync, and strategic AI opponents", type: "project", subject: "CS", trackId: "track-gamedev", status: "in-progress", progress: 45, estimatedHours: 40, prerequisites: ["pm-2"], skills: ["Networking", "State management", "Game AI", "Database design", "Real-time systems"], aiRationale: "Alex mentioned wanting to build something friends can play together. This introduces networking and multiplayer concepts through genuine motivation.",
  },
  {
    id: "pm-4", title: "Procedural World Generator", description: "Create an algorithm that generates unique game worlds with terrain, biomes, and structures", type: "project", subject: "Math", trackId: "track-gamedev", status: "not-started", progress: 0, estimatedHours: 30, prerequisites: ["pm-2", "cm-1"], skills: ["Algorithms", "Noise functions", "Probability", "Optimization", "Creative coding"], aiRationale: "Connects Alex's math skills with their love of game worlds. Procedural generation requires exactly the kind of pattern-thinking Alex excels at.",
  },
  {
    id: "pm-5", title: "Game Analytics Dashboard", description: "Build a real-time dashboard that tracks player behavior, engagement metrics, and play patterns", type: "project", subject: "CS", trackId: "track-gamedev", status: "not-started", progress: 0, estimatedHours: 25, prerequisites: ["pm-3"], skills: ["Data visualization", "Analytics", "API design", "Dashboard UX", "Statistics"], aiRationale: "Alex skips documentation — this project teaches the value of measurement and reflection through game data they actually care about.",
  },
  {
    id: "pm-6", title: "Full 3D Game Prototype", description: "Design and build a 3D game prototype with custom shaders, physics, and immersive world", type: "project", subject: "CS", trackId: "track-gamedev", status: "not-started", progress: 0, estimatedHours: 60, prerequisites: ["pm-4", "pm-5"], skills: ["3D graphics", "Shader programming", "Advanced physics", "Project management", "Game design document"], aiRationale: "The capstone. By this point Alex will have all the fundamentals — this lets them create something portfolio-worthy that showcases everything they've learned.",
  },
  {
    id: "pm-7", title: "Adaptive Difficulty Engine", description: "Build an AI system that adjusts game difficulty in real-time based on player performance", type: "project", subject: "CS", trackId: "track-ai", status: "not-started", progress: 0, estimatedHours: 35, prerequisites: ["pm-3"], skills: ["Machine learning basics", "Player modeling", "Reinforcement learning", "A/B testing"], aiRationale: "Alex's breakthrough moment was connecting recursion to game trees. This channels that excitement into real ML — applied to something they care about.",
  },
  {
    id: "pm-8", title: "AI Game Companion", description: "Create an NPC companion that learns from player behavior and develops its own personality over time", type: "project", subject: "Psychology", trackId: "track-ai", status: "not-started", progress: 0, estimatedHours: 45, prerequisites: ["pm-7"], skills: ["Natural language processing", "Personality modeling", "Behavioral psychology", "Agent architecture"], aiRationale: "Bridges Alex's growing interest in psychology with AI. An NPC that 'grows' will deeply engage their curiosity about motivation and personality.",
  },
];

export const mockCoreModules: CurriculumModule[] = [
  {
    id: "cm-1", title: "Mathematical Foundations for Computing", description: "Algebra, discrete math, and probability — framed through game math and CS applications", type: "core-content", subject: "Math", trackId: "track-core", status: "in-progress", progress: 70, estimatedHours: 15, prerequisites: [], skills: ["Algebra", "Discrete math", "Probability", "Logic"], aiRationale: "Alex needs these foundations for procedural generation and AI. Framed as 'game math' to maintain engagement.",
  },
  {
    id: "cm-2", title: "Technical Writing & Documentation", description: "Clear communication, project documentation, README writing, design documents", type: "core-content", subject: "General", trackId: "track-core", status: "in-progress", progress: 30, estimatedHours: 10, prerequisites: [], skills: ["Technical writing", "Documentation", "Communication", "Planning"], aiRationale: "Addresses Alex's weakness of skipping documentation. Taught through game design documents — writing they'll actually use.",
  },
  {
    id: "cm-3", title: "History of Technology & Games", description: "How technology and games shaped culture — from ancient board games to modern AI", type: "core-content", subject: "General", trackId: "track-core", status: "not-started", progress: 0, estimatedHours: 8, prerequisites: [], skills: ["Critical thinking", "Historical analysis", "Cultural awareness"], aiRationale: "Alex responds to stories and context. Learning history through the lens of games and tech will resonate.",
  },
  {
    id: "cm-4", title: "Psychology of Motivation & Flow", description: "What makes games engaging? Explore flow states, intrinsic motivation, and behavioral design", type: "core-content", subject: "Psychology", trackId: "track-core", status: "not-started", progress: 0, estimatedHours: 12, prerequisites: [], skills: ["Psychology fundamentals", "Motivation theory", "UX psychology", "Behavioral design"], aiRationale: "Feeds Alex's growing curiosity about motivation. Directly applicable to game design — they'll see immediate connections.",
  },
  {
    id: "cm-5", title: "Scientific Method & Experimentation", description: "Hypothesis testing, data collection, and analysis — applied to game testing and player research", type: "core-content", subject: "General", trackId: "track-core", status: "not-started", progress: 0, estimatedHours: 10, prerequisites: ["cm-1"], skills: ["Scientific method", "Data analysis", "Experimentation", "Critical thinking"], aiRationale: "Alex's trial-and-error learning style is close to the scientific method — formalizing it will enhance their natural approach.",
  },
];

export const mockCurriculumPlan: CurriculumPlan = {
  id: "curriculum-1",
  studentId: "student-1",
  generatedAt: "2024-09-05",
  lastUpdatedAt: "2024-12-01",
  version: 3,
  profileSummary: "Alex is a highly visual, hands-on learner with exceptional logical reasoning and pattern recognition. They're driven by a passion for game development and interactive systems, with a growing interest in AI and psychology. They work best in focused 45-60 minute bursts and learn through building rather than reading. Their natural strength in breaking down complex problems, combined with excitement about adaptive AI, points toward a path in game development with AI specialization.",
  primaryStrengths: ["Logical reasoning", "Pattern recognition", "Problem decomposition", "Spatial thinking"],
  primaryInterests: ["Game development", "AI systems", "Interactive design", "Player psychology"],
  learningStyle: "Visual-kinesthetic — learns by building, with immediate feedback",
  personalityTraits: ["Builder", "Visual thinker", "Sprint worker", "Curious explorer"],
  tracks: mockCurriculumTracks,
  projectModules: mockProjectModules,
  coreModules: mockCoreModules,
};
