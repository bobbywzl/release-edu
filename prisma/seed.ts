import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ── Demo Student: Alex Chen ────────────────────────────────
  const demo = await prisma.user.upsert({
    where: { email: 'demo@release.edu' },
    update: { name: 'Alex Chen', role: 'student' },
    create: {
      id: 'demo',
      email: 'demo@release.edu',
      name: 'Alex Chen',
      role: 'student',
      image: undefined,
    },
  })
  console.log('  ✓ Demo user:', demo.id)

  // ── Student Profile ────────────────────────────────────────
  await prisma.studentProfile.upsert({
    where: { userId: demo.id },
    update: {},
    create: {
      userId: demo.id,
      learningStage: 3,
      xp: 3240,
      streak: 14,
      learningStyle: 'visual',
      pacePreference: 'moderate',
      interests: JSON.stringify(['algorithms', 'game development', 'data structures', 'mathematics']),
      strengths: JSON.stringify(['logical reasoning', 'pattern recognition']),
      weaknesses: JSON.stringify(['dynamic programming', 'linear algebra']),
      aspirations: 'Build AI-powered games that adapt to players',
      isOnboarded: true,
    },
  })
  console.log('  ✓ Student profile')

  // ── Mentor Config ──────────────────────────────────────────
  const mentor = await prisma.user.upsert({
    where: { email: 'mentor@release.edu' },
    update: {},
    create: {
      email: 'mentor@release.edu',
      name: 'Ms. Rivera',
      role: 'mentor',
    },
  })
  await prisma.mentorConfig.upsert({
    where: { userId: mentor.id },
    update: {},
    create: {
      userId: mentor.id,
      socraticIntensity: 7,
      hintLevel: 5,
      difficultyBias: 5,
      celebrateMistakes: true,
      encourageExploration: true,
      focusTopics: JSON.stringify(['algorithms', 'data structures', 'mathematics', 'career development']),
      customInstructions: 'Emphasize connections between CS and mathematics. Encourage project-based thinking.',
      tonePreference: 'warm',
      maxResponseLength: 500,
      allowProjectIdeas: true,
      allowCareerAdvice: true,
    },
  })
  console.log('  ✓ Mentor config')

  // ── Curriculum Plan ────────────────────────────────────────
  await prisma.curriculumPlan.upsert({
    where: { userId: demo.id },
    update: {},
    create: {
      userId: demo.id,
      version: 1,
      profileSummary: 'Alex is a visual learner with strong logical reasoning skills. Deeply fascinated by game mechanics and interactive systems. Wants to build AI-powered games. Excels at pattern recognition and algorithmic thinking.',
      primaryStrengths: JSON.stringify(['Logical reasoning', 'Pattern recognition', 'Algorithmic thinking']),
      primaryInterests: JSON.stringify(['Game development', 'AI/ML', 'Interactive systems']),
      learningStyle: 'visual',
      personalityTraits: JSON.stringify(['Curious', 'Systematic', 'Creative problem-solver', 'Visual learner']),
    },
  })
  console.log('  ✓ Curriculum plan')

  // ── Insights ───────────────────────────────────────────────
  const insightData = [
    { type: 'interest', content: 'Deeply fascinated by game mechanics and interactive systems', confidence: 0.9, source: 'onboarding' },
    { type: 'strength', content: 'Strong logical reasoning and pattern recognition', confidence: 0.85, source: 'cs-algorithms-chat' },
    { type: 'personality', content: 'Visual learner who prefers building over reading theory', confidence: 0.8, source: 'onboarding' },
    { type: 'aspiration', content: 'Wants to build AI-powered games that adapt to players', confidence: 0.85, source: 'chat' },
    { type: 'style', content: 'Learns best through trial-and-error with immediate feedback loops', confidence: 0.8, source: 'multiple-sessions' },
  ]
  for (const ins of insightData) {
    await prisma.insight.create({ data: { userId: demo.id, ...ins } })
  }
  console.log('  ✓ Insights')

  // ── Tracks ─────────────────────────────────────────────────
  const trackCS = await prisma.track.create({
    data: {
      userId: demo.id,
      name: 'Computer Science',
      description: 'Algorithms, data structures, and software engineering fundamentals',
      color: '#3B82F6',
      type: 'project',
      order: 0,
    },
  })

  const trackMath = await prisma.track.create({
    data: {
      userId: demo.id,
      name: 'Mathematics',
      description: 'Linear algebra, calculus, and probability theory',
      color: '#8B5CF6',
      type: 'core',
      order: 1,
    },
  })

  const trackFinance = await prisma.track.create({
    data: {
      userId: demo.id,
      name: 'Finance',
      description: 'Personal finance, investing, and financial modeling',
      color: '#F59E0B',
      type: 'project',
      order: 2,
    },
  })

  const trackPsych = await prisma.track.create({
    data: {
      userId: demo.id,
      name: 'Psychology',
      description: 'Learning science, cognitive psychology, and UX design',
      color: '#EC4899',
      type: 'project',
      order: 3,
    },
  })
  console.log('  ✓ Tracks')

  // ── Curriculum Modules ─────────────────────────────────────
  const modules = [
    { trackId: trackCS.id, title: 'Algorithm Design & Analysis', type: 'project', subject: 'CS', status: 'in-progress', progress: 45, estimatedHours: 40, skills: JSON.stringify(['algorithms', 'complexity analysis', 'problem solving']), aiRationale: 'Core to your goal of building adaptive AI games — you need strong algorithmic foundations.' },
    { trackId: trackCS.id, title: 'Data Structures Deep Dive', type: 'project', subject: 'CS', status: 'in-progress', progress: 60, estimatedHours: 35, skills: JSON.stringify(['data structures', 'implementation', 'optimization']), aiRationale: 'Understanding data structures will make your game systems more efficient.' },
    { trackId: trackCS.id, title: 'Web Development with React', type: 'project', subject: 'CS', status: 'completed', progress: 100, estimatedHours: 30, skills: JSON.stringify(['React', 'TypeScript', 'frontend']), aiRationale: 'Essential for building the interactive visualizer and future game UIs.' },
    { trackId: trackMath.id, title: 'Linear Algebra Fundamentals', type: 'core-content', subject: 'Math', status: 'in-progress', progress: 35, estimatedHours: 25, skills: JSON.stringify(['linear algebra', 'matrices', 'vectors']), aiRationale: 'Critical for game physics, 3D rendering, and ML algorithms.' },
    { trackId: trackMath.id, title: 'Probability & Statistics', type: 'core-content', subject: 'Math', status: 'not-started', progress: 0, estimatedHours: 20, skills: JSON.stringify(['probability', 'statistics', 'data analysis']), aiRationale: 'Foundation for understanding ML models and adaptive game difficulty.' },
    { trackId: trackFinance.id, title: 'Portfolio Theory & Risk', type: 'project', subject: 'Finance', status: 'in-progress', progress: 65, estimatedHours: 25, skills: JSON.stringify(['finance', 'risk analysis', 'Python']), aiRationale: 'Combines your programming skills with real-world financial modeling.' },
    { trackId: trackPsych.id, title: 'Learning Science & Spaced Repetition', type: 'project', subject: 'Psychology', status: 'not-started', progress: 10, estimatedHours: 20, skills: JSON.stringify(['learning science', 'UX', 'psychology']), aiRationale: 'Understanding how people learn will make your educational games more effective.' },
  ]
  for (const mod of modules) {
    await prisma.curriculumModule.create({ data: { ...mod, order: modules.indexOf(mod) } })
  }
  console.log('  ✓ Curriculum modules')

  // ── CS Track: Chapters ─────────────────────────────────────
  const csChapters = [
    { title: 'Introduction to Algorithms', description: 'What are algorithms and why do they matter?', status: 'completed', estimatedMinutes: 45, keyTopics: JSON.stringify(['Big O notation', 'Algorithm design', 'Computational thinking']), content: '# Introduction to Algorithms\n\nAn algorithm is a step-by-step procedure for solving a problem or accomplishing a task. In computer science, algorithms are the foundation of everything we build.\n\n## Why Algorithms Matter\n\nEvery piece of software you use — from search engines to social media feeds to game AI — relies on algorithms. Understanding them gives you the power to:\n\n- **Solve complex problems** efficiently\n- **Optimize performance** when it matters\n- **Think computationally** about any challenge\n\n## Big O Notation\n\nWe measure algorithm efficiency using Big O notation:\n- **O(1)** — Constant time (hash table lookup)\n- **O(log n)** — Logarithmic (binary search)\n- **O(n)** — Linear (simple search)\n- **O(n log n)** — Linearithmic (merge sort)\n- **O(n²)** — Quadratic (bubble sort)' },
    { title: 'Sorting Algorithms', description: 'Comparison and non-comparison based sorting techniques', status: 'completed', estimatedMinutes: 60, keyTopics: JSON.stringify(['Bubble sort', 'Merge sort', 'Quick sort', 'Heap sort']), content: '# Sorting Algorithms\n\nSorting is one of the most fundamental operations in computer science. Understanding different sorting approaches reveals key algorithmic paradigms.\n\n## Divide and Conquer: Merge Sort\n\nMerge sort splits the array in half, sorts each half, then merges them back together.\n\n```python\ndef merge_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    mid = len(arr) // 2\n    left = merge_sort(arr[:mid])\n    right = merge_sort(arr[mid:])\n    return merge(left, right)\n```\n\nTime: O(n log n) always. Space: O(n).\n\n## Quick Sort\n\nChoose a pivot, partition around it, sort each partition.\n\nAverage: O(n log n). Worst: O(n²) but rare with good pivot selection.' },
    { title: 'Graph Algorithms', description: 'BFS, DFS, shortest paths, and graph representations', status: 'in-progress', estimatedMinutes: 60, keyTopics: JSON.stringify(['BFS', 'DFS', 'Dijkstra', 'Graph representations']), content: '# Graph Algorithms\n\nGraphs are everywhere — social networks, maps, game worlds, dependency trees. Mastering graph algorithms unlocks a huge class of problems.\n\n## Representations\n\n**Adjacency List**: Space-efficient for sparse graphs. Each node stores a list of neighbors.\n\n**Adjacency Matrix**: O(1) edge lookup but O(V²) space.\n\n## Breadth-First Search (BFS)\n\nExplores level by level. Perfect for finding shortest paths in unweighted graphs.\n\n## Depth-First Search (DFS)\n\nExplores as deep as possible before backtracking. Great for detecting cycles, topological sorting.' },
    { title: 'Dynamic Programming', description: 'Breaking complex problems into overlapping subproblems', status: 'not-started', estimatedMinutes: 75, keyTopics: JSON.stringify(['Memoization', 'Tabulation', 'Optimal substructure', 'Overlapping subproblems']), content: '# Dynamic Programming\n\nDP is an optimization technique for problems that can be broken into overlapping subproblems with optimal substructure.\n\n## Two Approaches\n\n**Top-down (Memoization)**: Solve recursively, cache results.\n\n**Bottom-up (Tabulation)**: Build solution iteratively from base cases.\n\n## Classic Example: Fibonacci\n\n```python\n# Naive: O(2^n)\ndef fib(n):\n    if n <= 1: return n\n    return fib(n-1) + fib(n-2)\n\n# Memoized: O(n)\ndef fib_memo(n, memo={}):\n    if n in memo: return memo[n]\n    if n <= 1: return n\n    memo[n] = fib_memo(n-1, memo) + fib_memo(n-2, memo)\n    return memo[n]\n```' },
    { title: 'System Design Basics', description: 'Designing scalable systems and architecture patterns', status: 'not-started', estimatedMinutes: 60, keyTopics: JSON.stringify(['Scalability', 'Load balancing', 'Caching', 'Database design']), content: '# System Design Basics\n\nSystem design is about building software that works at scale — handling millions of users, petabytes of data, and 99.99% uptime.\n\n## Key Concepts\n\n**Horizontal vs Vertical Scaling**: Adding more machines vs making one machine bigger.\n\n**Load Balancing**: Distributing requests across multiple servers.\n\n**Caching**: Storing frequently accessed data in fast memory (Redis, Memcached).\n\n**Database Sharding**: Splitting data across multiple databases.' },
  ]
  for (let i = 0; i < csChapters.length; i++) {
    await prisma.chapter.create({ data: { trackId: trackCS.id, ...csChapters[i], order: i } })
  }
  console.log('  ✓ CS chapters')

  // ── Math Track: Chapters ───────────────────────────────────
  const mathChapters = [
    { title: 'Vectors and Spaces', description: 'Introduction to vector spaces and linear independence', status: 'completed', estimatedMinutes: 45, keyTopics: JSON.stringify(['Vectors', 'Linear independence', 'Span', 'Basis']), content: '# Vectors and Spaces\n\nVectors are the building blocks of linear algebra — and by extension, of computer graphics, machine learning, and physics simulations.\n\n## What is a Vector?\n\nA vector is simply an ordered list of numbers. In 2D: [x, y]. In 3D: [x, y, z]. In ML, vectors can have thousands of dimensions.\n\n## Vector Operations\n- **Addition**: [1,2] + [3,4] = [4,6]\n- **Scalar multiplication**: 3 × [1,2] = [3,6]\n- **Dot product**: [1,2] · [3,4] = 3+8 = 11' },
    { title: 'Matrices and Transformations', description: 'Matrix operations and their geometric meaning', status: 'in-progress', estimatedMinutes: 60, keyTopics: JSON.stringify(['Matrix multiplication', 'Transformations', 'Inverse matrices', 'Determinants']), content: '# Matrices and Transformations\n\nA matrix is a rectangular array of numbers. But more importantly, a matrix represents a *transformation* — a way to transform vectors from one space to another.\n\n## Key Insight\n\nWhen you multiply a matrix by a vector, you\'re applying a transformation. Rotation, scaling, shearing — all can be represented as matrices.\n\n## Matrix Multiplication\n\nRows of A × Columns of B. The result captures the composition of two transformations.' },
    { title: 'Eigenvalues and Eigenvectors', description: 'Understanding the fundamental decomposition of linear transformations', status: 'not-started', estimatedMinutes: 60, keyTopics: JSON.stringify(['Eigenvalues', 'Eigenvectors', 'Diagonalization', 'PCA']), content: '# Eigenvalues and Eigenvectors\n\nEigenvectors are the directions that don\'t change under a transformation — they only get scaled. The scaling factor is the eigenvalue.\n\n## Intuition\n\nImagine stretching a rubber sheet. Most points move in complicated ways. But some special directions just stretch or compress — those are eigenvectors.\n\n## Why They Matter\n- **PCA**: Finding the most important dimensions in data\n- **Google PageRank**: Finding the most important web pages\n- **Quantum mechanics**: Observable states' },
    { title: 'Probability Foundations', description: 'Probability theory and common distributions', status: 'not-started', estimatedMinutes: 50, keyTopics: JSON.stringify(['Probability axioms', 'Bayes theorem', 'Distributions', 'Expected value']), content: '# Probability Foundations\n\nProbability is the mathematics of uncertainty — essential for AI, game design, and decision-making under incomplete information.\n\n## Bayes\' Theorem\n\nP(A|B) = P(B|A) × P(A) / P(B)\n\nThis simple formula is the foundation of modern machine learning, spam filters, and medical diagnosis.' },
  ]
  for (let i = 0; i < mathChapters.length; i++) {
    await prisma.chapter.create({ data: { trackId: trackMath.id, ...mathChapters[i], order: i } })
  }
  console.log('  ✓ Math chapters')

  // ── Homework ───────────────────────────────────────────────
  const homework = [
    { trackId: trackCS.id, title: 'Implement Binary Search Tree', instructions: 'Build a BST with insert, delete, and traversal methods. Analyze time complexity for each operation.', status: 'completed', competencies: JSON.stringify(['Data Structures', 'Algorithm Design']), estimatedMinutes: 45 },
    { trackId: trackCS.id, title: 'Sorting Algorithm Comparison', instructions: 'Benchmark merge sort, quick sort, and heap sort on various input sizes. Write an analysis report comparing performance.', status: 'in-progress', competencies: JSON.stringify(['Algorithms', 'Performance Analysis', 'Technical Writing']), estimatedMinutes: 40, dueDate: new Date('2026-03-28') },
    { trackId: trackCS.id, title: 'Build a REST API', instructions: 'Create a CRUD API with authentication, validation, and error handling using Express.js.', status: 'not-started', competencies: JSON.stringify(['Web Development', 'API Design', 'Node.js']), estimatedMinutes: 60, dueDate: new Date('2026-04-15') },
    { trackId: trackMath.id, title: 'Eigenvalue Decomposition Worksheet', instructions: 'Solve 10 eigenvalue problems and interpret each geometrically using 3Blue1Brown intuition.', status: 'in-progress', competencies: JSON.stringify(['Linear Algebra', 'Mathematical Intuition']), estimatedMinutes: 40, dueDate: new Date('2026-03-30') },
    { trackId: trackFinance.id, title: 'Portfolio Risk Analysis', instructions: 'Calculate Sharpe ratio, beta, and max drawdown for a sample 5-stock portfolio.', status: 'completed', competencies: JSON.stringify(['Investing', 'Risk Management', 'Python']), estimatedMinutes: 35 },
  ]
  for (const hw of homework) {
    await prisma.homework.create({ data: hw })
  }
  console.log('  ✓ Homework')

  // ── Quizzes ────────────────────────────────────────────────
  const quiz1 = await prisma.quiz.create({
    data: {
      trackId: trackCS.id,
      title: 'Sorting Algorithms Quiz',
      description: 'Test your understanding of comparison-based sorting',
      status: 'completed',
      score: 4,
      totalPoints: 5,
      timeLimit: 15,
      completedAt: new Date('2026-03-20'),
    },
  })
  const q1questions = [
    { question: 'What is the average time complexity of Quick Sort?', type: 'multiple-choice', options: JSON.stringify(['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)']), correctAnswer: 'O(n log n)', explanation: 'Quick Sort averages O(n log n) with good pivot selection.', points: 1 },
    { question: 'Merge Sort is an in-place sorting algorithm.', type: 'true-false', options: JSON.stringify(['True', 'False']), correctAnswer: 'False', explanation: 'Merge Sort requires O(n) extra space for merging.', points: 1 },
    { question: 'Which sorting algorithm has the best worst-case performance?', type: 'multiple-choice', options: JSON.stringify(['Quick Sort', 'Bubble Sort', 'Merge Sort', 'Selection Sort']), correctAnswer: 'Merge Sort', explanation: 'Merge Sort guarantees O(n log n) in all cases.', points: 1 },
    { question: 'What is the space complexity of Heap Sort?', type: 'multiple-choice', options: JSON.stringify(['O(1)', 'O(n)', 'O(n log n)', 'O(log n)']), correctAnswer: 'O(1)', explanation: 'Heap Sort sorts in-place with only O(1) extra space.', points: 1 },
    { question: 'Bubble Sort can detect if an array is already sorted.', type: 'true-false', options: JSON.stringify(['True', 'False']), correctAnswer: 'True', explanation: 'With an optimized flag, Bubble Sort can exit early if no swaps occur.', points: 1 },
  ]
  for (let i = 0; i < q1questions.length; i++) {
    await prisma.quizQuestion.create({ data: { quizId: quiz1.id, ...q1questions[i], order: i } })
  }

  const quiz2 = await prisma.quiz.create({
    data: {
      trackId: trackCS.id,
      title: 'Graph Algorithms Quiz',
      description: 'BFS, DFS, and graph fundamentals',
      status: 'not-started',
      totalPoints: 5,
      timeLimit: 15,
    },
  })
  const q2questions = [
    { question: 'BFS uses which data structure?', type: 'multiple-choice', options: JSON.stringify(['Stack', 'Queue', 'Heap', 'Array']), correctAnswer: 'Queue', explanation: 'BFS uses a queue to explore nodes level by level.', points: 1 },
    { question: 'DFS can be implemented using recursion.', type: 'true-false', options: JSON.stringify(['True', 'False']), correctAnswer: 'True', explanation: 'The call stack naturally implements DFS behavior.', points: 1 },
    { question: 'What is the time complexity of BFS on an adjacency list?', type: 'multiple-choice', options: JSON.stringify(['O(V)', 'O(E)', 'O(V + E)', 'O(V × E)']), correctAnswer: 'O(V + E)', explanation: 'BFS visits every vertex and edge once.', points: 1 },
    { question: 'Which algorithm finds shortest paths in weighted graphs?', type: 'multiple-choice', options: JSON.stringify(['BFS', 'DFS', 'Dijkstra', 'Bubble Sort']), correctAnswer: 'Dijkstra', explanation: "Dijkstra's algorithm uses a priority queue for weighted shortest paths.", points: 1 },
    { question: 'A tree is a special case of a graph.', type: 'true-false', options: JSON.stringify(['True', 'False']), correctAnswer: 'True', explanation: 'A tree is a connected acyclic graph.', points: 1 },
  ]
  for (let i = 0; i < q2questions.length; i++) {
    await prisma.quizQuestion.create({ data: { quizId: quiz2.id, ...q2questions[i], order: i } })
  }
  console.log('  ✓ Quizzes')

  // ── Projects ───────────────────────────────────────────────
  const csProject = await prisma.subjectProject.create({
    data: {
      trackId: trackCS.id,
      title: 'Algorithm Visualizer',
      description: 'Interactive web app that visualizes sorting and graph algorithms in real-time',
      proposal: 'I want to build a web app where users can watch algorithms execute step-by-step. It will cover sorting algorithms (bubble, merge, quick) and graph algorithms (BFS, DFS). Users can control speed, step through, and see complexity analysis. This covers algorithm design, data structures, web dev, and visualization — touching every chapter in the CS track.',
      status: 'in-progress',
      progress: 40,
      coverageMap: JSON.stringify(['Sorting Algorithms', 'Graph Algorithms', 'Data Structures', 'Web Development']),
    },
  })
  await prisma.projectTask.createMany({
    data: [
      { projectId: csProject.id, title: 'Design UI/UX wireframes', completed: true, order: 0 },
      { projectId: csProject.id, title: 'Implement sorting animations', completed: true, order: 1 },
      { projectId: csProject.id, title: 'Add graph BFS/DFS visualizations', completed: false, order: 2 },
      { projectId: csProject.id, title: 'Build speed controls and step-through', completed: false, order: 3 },
      { projectId: csProject.id, title: 'Write tutorial content', completed: false, order: 4 },
    ],
  })
  await prisma.projectMilestone.createMany({
    data: [
      { projectId: csProject.id, title: 'Design Phase', completed: true, date: new Date('2026-02-10'), order: 0 },
      { projectId: csProject.id, title: 'Basic Sorts', completed: true, date: new Date('2026-03-01'), order: 1 },
      { projectId: csProject.id, title: 'Graph Algorithms', completed: false, date: new Date('2026-04-05'), order: 2 },
      { projectId: csProject.id, title: 'Launch', completed: false, date: new Date('2026-04-15'), order: 3 },
    ],
  })

  const finProject = await prisma.subjectProject.create({
    data: {
      trackId: trackFinance.id,
      title: 'Stock Portfolio Analyzer',
      description: 'Python app that fetches real-time stock data, calculates portfolio metrics, and visualizes performance',
      proposal: 'I will build a portfolio analyzer that connects to real stock data APIs, computes key financial metrics (Sharpe ratio, beta, VaR), and generates visualizations using matplotlib. This project covers portfolio theory, risk management, and Python data analysis.',
      status: 'in-progress',
      progress: 65,
      coverageMap: JSON.stringify(['Portfolio Theory', 'Risk Analysis', 'Data Visualization', 'Python']),
    },
  })
  await prisma.projectTask.createMany({
    data: [
      { projectId: finProject.id, title: 'Set up Python project structure', completed: true, order: 0 },
      { projectId: finProject.id, title: 'Integrate stock data API', completed: true, order: 1 },
      { projectId: finProject.id, title: 'Build portfolio metrics calculator', completed: true, order: 2 },
      { projectId: finProject.id, title: 'Create matplotlib visualizations', completed: false, order: 3 },
      { projectId: finProject.id, title: 'Add portfolio comparison vs S&P 500', completed: false, order: 4 },
    ],
  })
  console.log('  ✓ Projects')

  // ── Sample Conversations ───────────────────────────────────
  const conv1 = await prisma.conversation.create({
    data: {
      userId: demo.id,
      title: 'System Design Interview Prep',
      context: 'CS',
    },
  })
  await prisma.message.createMany({
    data: [
      { conversationId: conv1.id, role: 'user', content: 'I have a system design interview coming up. Can we practice designing a URL shortener?' },
      { conversationId: conv1.id, role: 'assistant', content: "Great timing to practice! Before I show you how I'd approach it, let me ask you some questions first — this mirrors what real interviewers want to see.\n\n**Start with clarifying questions:**\n\n1. What's the scale? How many URLs per day? Reads vs writes ratio?\n2. Should shortened URLs be permanent or have expiry?\n3. Any custom alias support needed?\n4. Geographic distribution requirements?\n\nWhat do you think the first thing you'd say to the interviewer is?" },
      { conversationId: conv1.id, role: 'user', content: "I'd ask about scale first — like 100M URLs per day, mostly reads." },
      { conversationId: conv1.id, role: 'assistant', content: "Perfect instinct! Scale-first is exactly right. Now let's think through the architecture together.\n\n**With 100M URLs/day:**\n- That's ~1,150 writes/second\n- If reads are 100:1 ratio → ~115,000 reads/second\n\n**What does that tell you about the storage approach?** Think about SQL vs NoSQL, caching layers, and how you'd generate the short code." },
    ],
  })

  const conv2 = await prisma.conversation.create({
    data: {
      userId: demo.id,
      title: 'Understanding Eigenvalues',
      context: 'Math',
    },
  })
  await prisma.message.createMany({
    data: [
      { conversationId: conv2.id, role: 'user', content: "I keep getting lost with eigenvalues and eigenvectors. I can do the calculations but I don't understand what they actually mean." },
      { conversationId: conv2.id, role: 'assistant', content: "This is one of the most common stumbling blocks in linear algebra — and it's totally valid. Knowing the calculation but not the meaning is exactly the gap we need to close.\n\nLet me ask you something first: when you multiply a matrix by a vector, what do you think is happening geometrically? What is the transformation *doing* to the vector?\n\n(There's no wrong answer — just describe it in your own words, even if it feels fuzzy.)" },
    ],
  })
  console.log('  ✓ Conversations')

  console.log('\n✅ Database seeded successfully!')
}

main()
  .catch(e => {
    console.error('Seed error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
