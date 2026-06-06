/**
 * Seeds a demo user with ~1 year of realistic activity data.
 * Everything is interactive — Bob still works, highlights work, history works.
 */
import prisma from '@/lib/prisma'

export async function seedDemoUser(userId: string) {
  // Check if already seeded
  const existing = await prisma.studentProfile.findUnique({ where: { userId } })
  if (existing?.isOnboarded) return // already set up

  const now = new Date()
  const oneYearAgo = new Date(now)
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const twoMonthsAgo = new Date(now)
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)

  // ── User + Profile ──
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email: `${userId}@release.edu`, name: 'Jordan Rivera' },
  })

  await prisma.studentProfile.upsert({
    where: { userId },
    update: {
      isOnboarded: true,
      xp: 12450,
      streak: 23,
      learningStage: 3,
      learningStyle: 'hands-on',
      pacePreference: 'moderate',
      interests: JSON.stringify(['machine learning', 'cognitive science', 'game design', 'music production']),
      strengths: JSON.stringify(['pattern recognition', 'creative problem-solving', 'self-directed learning']),
      weaknesses: JSON.stringify(['time management', 'math notation']),
      aspirations: 'Build AI-powered creative tools that blend music and visual art',
    },
    create: {
      userId,
      displayName: 'Jordan',
      isOnboarded: true,
      xp: 12450,
      streak: 23,
      learningStage: 3,
      learningStyle: 'hands-on',
      pacePreference: 'moderate',
      interests: JSON.stringify(['machine learning', 'cognitive science', 'game design', 'music production']),
      strengths: JSON.stringify(['pattern recognition', 'creative problem-solving', 'self-directed learning']),
      weaknesses: JSON.stringify(['time management', 'math notation']),
      aspirations: 'Build AI-powered creative tools that blend music and visual art',
    },
  })

  // ── Mentor Config ──
  await prisma.mentorConfig.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      socraticIntensity: 7,
      hintLevel: 5,
      difficultyBias: 6,
      celebrateMistakes: true,
      encourageExploration: true,
      tonePreference: 'warm',
      maxResponseLength: 500,
      allowProjectIdeas: true,
      allowCareerAdvice: true,
    },
  })

  // ── Current Curriculum Plan ──
  await prisma.curriculumPlan.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      version: 3,
      profileSummary: 'A creative technologist passionate about AI, music, and interactive experiences. Strong pattern recognition and self-direction. Building toward AI-powered creative tools.',
      primaryStrengths: JSON.stringify(['pattern recognition', 'creative thinking', 'self-directed learning']),
      primaryInterests: JSON.stringify(['AI for creative tools', 'neural audio synthesis', 'interactive media']),
      learningStyle: 'hands-on',
      personalityTraits: JSON.stringify(['curious', 'persistent', 'visual thinker']),
      generatedAt: twoMonthsAgo,
      lockedAt: new Date(twoMonthsAgo.getTime() + 3 * 24 * 60 * 60 * 1000),
    },
  })

  // ── Current Active Tracks ──
  const trackData = [
    {
      name: 'Neural Audio Synthesis & Sound Design',
      description: 'Deep dive into AI-powered audio generation, from WaveNet to diffusion models for music.',
      color: '#8B5CF6', type: 'project', order: 0, progress: 65, trackStatus: 'in-progress',
      chapters: [
        { title: 'Fundamentals of Digital Audio', status: 'completed', sessionScore: 88, keyTopics: '["sampling rate","bit depth","FFT","spectrograms"]', order: 0 },
        { title: 'Audio Feature Extraction', status: 'completed', sessionScore: 82, keyTopics: '["MFCCs","chroma features","onset detection"]', order: 1 },
        { title: 'Autoregressive Models for Audio', status: 'completed', sessionScore: 75, keyTopics: '["WaveNet","SampleRNN","causal convolutions"]', order: 2 },
        { title: 'Diffusion Models for Sound', status: 'in-progress', sessionScore: null, keyTopics: '["denoising","score matching","AudioLDM"]', order: 3 },
        { title: 'Real-Time Audio Processing', status: 'not-started', sessionScore: null, keyTopics: '["latency","buffering","WebAudio API"]', order: 4 },
      ],
    },
    {
      name: 'Generative AI Art & Visual Systems',
      description: 'Creating AI-driven visual experiences — from GANs to latent diffusion and creative coding.',
      color: '#EC4899', type: 'project', order: 1, progress: 40, trackStatus: 'in-progress',
      chapters: [
        { title: 'Image Generation Fundamentals', status: 'completed', sessionScore: 91, keyTopics: '["GANs","VAEs","latent spaces"]', order: 0 },
        { title: 'Stable Diffusion Architecture', status: 'completed', sessionScore: 85, keyTopics: '["U-Net","CLIP","classifier-free guidance"]', order: 1 },
        { title: 'ControlNet & Guided Generation', status: 'in-progress', sessionScore: null, keyTopics: '["conditioning","ControlNet","LoRA"]', order: 2 },
        { title: 'Creative Coding with p5.js', status: 'not-started', sessionScore: null, keyTopics: '["generative art","shaders","animation"]', order: 3 },
        { title: 'Building Interactive Installations', status: 'not-started', sessionScore: null, keyTopics: '["sensors","projection mapping","real-time"]', order: 4 },
      ],
    },
    {
      name: 'Interactive Game Design & Prototyping',
      description: 'Design philosophy, mechanics, and rapid prototyping for interactive experiences.',
      color: '#F59E0B', type: 'project', order: 2, progress: 25, trackStatus: 'in-progress',
      chapters: [
        { title: 'Game Design Principles', status: 'completed', sessionScore: 93, keyTopics: '["MDA framework","flow state","player motivation"]', order: 0 },
        { title: 'Rapid Prototyping Methods', status: 'in-progress', sessionScore: null, keyTopics: '["paper prototypes","digital mockups","playtesting"]', order: 1 },
        { title: 'Procedural Content Generation', status: 'not-started', sessionScore: null, keyTopics: '["noise functions","L-systems","wave function collapse"]', order: 2 },
        { title: 'Narrative Design & Branching Stories', status: 'not-started', sessionScore: null, keyTopics: '["dialogue trees","player agency","emergent narrative"]', order: 3 },
      ],
    },
    {
      name: 'Linear Algebra & Matrix Methods',
      description: 'The mathematical backbone of ML — vectors, matrices, transformations, and decompositions.',
      color: '#10B981', type: 'core', order: 3, progress: 80, trackStatus: 'in-progress',
      chapters: [
        { title: 'Vectors & Vector Spaces', status: 'completed', sessionScore: 78, keyTopics: '["basis","span","linear independence"]', order: 0 },
        { title: 'Matrix Operations & Transformations', status: 'completed', sessionScore: 84, keyTopics: '["multiplication","inverse","determinant"]', order: 1 },
        { title: 'Eigenvalues & Eigenvectors', status: 'completed', sessionScore: 72, keyTopics: '["eigendecomposition","diagonalization","PCA"]', order: 2 },
        { title: 'SVD & Matrix Factorization', status: 'completed', sessionScore: 68, keyTopics: '["SVD","low-rank approximation","recommender systems"]', order: 3 },
        { title: 'Applications in ML', status: 'not-started', sessionScore: null, keyTopics: '["gradient descent","backprop matrices","attention"]', order: 4 },
      ],
    },
    {
      name: 'Probability & Statistical Thinking',
      description: 'Bayesian reasoning, distributions, and statistical intuition for ML practitioners.',
      color: '#06B6D4', type: 'core', order: 4, progress: 55, trackStatus: 'in-progress',
      chapters: [
        { title: 'Probability Foundations', status: 'completed', sessionScore: 86, keyTopics: '["Bayes theorem","conditional probability","independence"]', order: 0 },
        { title: 'Common Distributions', status: 'completed', sessionScore: 79, keyTopics: '["normal","Poisson","Bernoulli","beta"]', order: 1 },
        { title: 'Maximum Likelihood & Estimation', status: 'in-progress', sessionScore: null, keyTopics: '["MLE","MAP","bias-variance"]', order: 2 },
        { title: 'Hypothesis Testing & Confidence', status: 'not-started', sessionScore: null, keyTopics: '["p-values","A/B testing","confidence intervals"]', order: 3 },
      ],
    },
  ]

  for (const t of trackData) {
    const track = await prisma.track.create({
      data: {
        userId,
        name: t.name,
        description: t.description,
        color: t.color,
        type: t.type,
        order: t.order,
        progress: t.progress,
        trackStatus: t.trackStatus,
      },
    })

    for (const ch of t.chapters) {
      await prisma.chapter.create({
        data: {
          trackId: track.id,
          title: ch.title,
          description: `Comprehensive study of ${ch.title.toLowerCase()}.`,
          status: ch.status,
          sessionScore: ch.sessionScore,
          keyTopics: ch.keyTopics,
          estimatedMinutes: 45,
          order: ch.order,
        },
      })
    }
  }

  // ── Archived Curriculum Blocks (past curricula) ──
  await prisma.curriculumBlock.createMany({
    data: [
      {
        userId,
        title: 'Python Programming & Data Science Foundations',
        profileSummary: 'Began as a complete beginner interested in coding and data. Focused on Python fundamentals, data manipulation, and basic ML.',
        primaryInterests: JSON.stringify(['Python', 'data science', 'automation']),
        primaryStrengths: JSON.stringify(['logical thinking', 'persistence']),
        learningStyle: 'hands-on',
        totalChapters: 18,
        completedChapters: 18,
        totalXp: 4200,
        overallProgress: 100,
        tracksJson: JSON.stringify([
          { name: 'Python Fundamentals', type: 'project', color: '#3B82F6', progress: 100, chapters: [
            { title: 'Variables & Data Types', status: 'completed', sessionScore: 72 },
            { title: 'Control Flow & Loops', status: 'completed', sessionScore: 78 },
            { title: 'Functions & Modules', status: 'completed', sessionScore: 85 },
            { title: 'OOP in Python', status: 'completed', sessionScore: 80 },
          ]},
          { name: 'Data Science with Pandas', type: 'project', color: '#8B5CF6', progress: 100, chapters: [
            { title: 'DataFrames & Series', status: 'completed', sessionScore: 88 },
            { title: 'Data Cleaning', status: 'completed', sessionScore: 82 },
            { title: 'Visualization with Matplotlib', status: 'completed', sessionScore: 90 },
          ]},
          { name: 'Intro to Machine Learning', type: 'project', color: '#EC4899', progress: 100, chapters: [
            { title: 'Supervised Learning Basics', status: 'completed', sessionScore: 76 },
            { title: 'Decision Trees & Random Forests', status: 'completed', sessionScore: 81 },
            { title: 'Neural Network Fundamentals', status: 'completed', sessionScore: 74 },
          ]},
          { name: 'Mathematics for CS', type: 'core', color: '#10B981', progress: 100, chapters: [
            { title: 'Discrete Math', status: 'completed', sessionScore: 70 },
            { title: 'Basic Calculus', status: 'completed', sessionScore: 65 },
          ]},
        ]),
        insightsJson: JSON.stringify([
          { type: 'strength', content: 'Quick to grasp practical applications — learns best through building', confidence: 0.9 },
          { type: 'strength', content: 'Strong debugging instincts — methodical approach to error-solving', confidence: 0.85 },
          { type: 'weakness', content: 'Tends to skip theoretical foundations — struggles with math notation', confidence: 0.8 },
          { type: 'interest', content: 'Fascinated by creative applications of code — kept asking about generative art', confidence: 0.9 },
          { type: 'personality', content: 'Visual learner — responds much better to diagrams and visual examples than text', confidence: 0.85 },
        ]),
        sessionOutcomesJson: JSON.stringify([
          { subjectArea: 'Python', endScore: 85, passed: true, messageCount: 24 },
          { subjectArea: 'Data Science', endScore: 88, passed: true, messageCount: 31 },
          { subjectArea: 'Machine Learning', endScore: 76, passed: true, messageCount: 28 },
        ]),
        highlightsJson: JSON.stringify([
          { selectedText: 'A neural network is just a function that maps inputs to outputs through learned weights', comment: 'Key insight!', color: 'amber' },
          { selectedText: 'Overfitting happens when the model memorizes training data instead of learning patterns', comment: null, color: 'blue' },
        ]),
        startedAt: oneYearAgo,
        lockedAt: new Date(oneYearAgo.getTime() + 3 * 24 * 60 * 60 * 1000),
        archivedAt: sixMonthsAgo,
        includedInPortfolio: true,
      },
      {
        userId,
        title: 'Deep Learning & Computer Vision',
        profileSummary: 'Second curriculum focused on deep learning architectures, CNNs, and computer vision applications. Building toward AI art generation.',
        primaryInterests: JSON.stringify(['deep learning', 'computer vision', 'image generation']),
        primaryStrengths: JSON.stringify(['pattern recognition', 'creative problem-solving', 'Python proficiency']),
        learningStyle: 'hands-on',
        totalChapters: 15,
        completedChapters: 12,
        totalXp: 5800,
        overallProgress: 80,
        tracksJson: JSON.stringify([
          { name: 'Deep Learning Architectures', type: 'project', color: '#F59E0B', progress: 100, chapters: [
            { title: 'Feedforward Networks', status: 'completed', sessionScore: 88 },
            { title: 'CNNs & Image Classification', status: 'completed', sessionScore: 92 },
            { title: 'RNNs & Sequence Models', status: 'completed', sessionScore: 78 },
            { title: 'Transformers & Attention', status: 'completed', sessionScore: 85 },
          ]},
          { name: 'Computer Vision Applications', type: 'project', color: '#EF4444', progress: 75, chapters: [
            { title: 'Object Detection (YOLO)', status: 'completed', sessionScore: 86 },
            { title: 'Image Segmentation', status: 'completed', sessionScore: 80 },
            { title: 'Style Transfer', status: 'completed', sessionScore: 91 },
            { title: 'Video Understanding', status: 'not-started', sessionScore: null },
          ]},
          { name: 'Calculus & Optimization', type: 'core', color: '#10B981', progress: 100, chapters: [
            { title: 'Multivariable Calculus', status: 'completed', sessionScore: 72 },
            { title: 'Gradient Descent Methods', status: 'completed', sessionScore: 80 },
            { title: 'Convex Optimization', status: 'completed', sessionScore: 68 },
          ]},
        ]),
        insightsJson: JSON.stringify([
          { type: 'breakthrough', content: 'Had a major "aha" moment connecting convolution filters to feature detection', confidence: 0.95 },
          { type: 'strength', content: 'Excellent at building mental models of network architectures', confidence: 0.9 },
          { type: 'weakness', content: 'Still struggles with mathematical proofs — prefers intuitive understanding', confidence: 0.8 },
          { type: 'interest', content: 'Deeply engaged with style transfer — spent extra time exploring artistic applications', confidence: 0.95 },
        ]),
        sessionOutcomesJson: JSON.stringify([
          { subjectArea: 'Deep Learning', endScore: 86, passed: true, messageCount: 35 },
          { subjectArea: 'Computer Vision', endScore: 85, passed: true, messageCount: 29 },
          { subjectArea: 'Calculus', endScore: 73, passed: true, messageCount: 22 },
        ]),
        highlightsJson: JSON.stringify([
          { selectedText: 'Attention is really just a soft dictionary lookup — queries find relevant keys', comment: 'This clicked for me', color: 'green' },
          { selectedText: 'Style transfer separates content and style by targeting different layers', comment: 'Want to build this into my project', color: 'purple' },
        ]),
        startedAt: sixMonthsAgo,
        lockedAt: new Date(sixMonthsAgo.getTime() + 3 * 24 * 60 * 60 * 1000),
        archivedAt: twoMonthsAgo,
        includedInPortfolio: true,
      },
    ],
  })

  // ── Insights (current curriculum) ──
  await prisma.insight.createMany({
    data: [
      { userId, type: 'strength', content: 'Exceptional at connecting concepts across domains — sees audio/visual/ML parallels naturally', confidence: 0.92, source: 'chat-observation' },
      { userId, type: 'strength', content: 'Self-directed learner — regularly explores topics beyond the curriculum', confidence: 0.88, source: 'chat-observation' },
      { userId, type: 'breakthrough', content: 'Made a key connection between diffusion models in audio and image generation', confidence: 0.95, source: 'chat-observation' },
      { userId, type: 'weakness', content: 'Math notation still challenging — benefits from visual/intuitive explanations first', confidence: 0.82, source: 'chat-observation' },
      { userId, type: 'interest', content: 'Increasingly interested in real-time AI systems — latency and performance', confidence: 0.87, source: 'chat-observation' },
      { userId, type: 'personality', content: 'Thrives when given creative freedom — engagement drops with purely theoretical exercises', confidence: 0.9, source: 'chat-observation' },
      { userId, type: 'preference', content: 'Prefers project-based assessment over quizzes', confidence: 0.85, source: 'chat-observation' },
    ],
  })

  // ── A sample conversation so chat isn't empty ──
  const conv = await prisma.conversation.create({
    data: {
      userId,
      title: 'Diffusion Models for Audio — Session',
      context: 'chapter-session',
    },
  })

  await prisma.message.createMany({
    data: [
      { conversationId: conv.id, role: 'assistant', content: "Welcome back, Jordan! Last time we covered the fundamentals of autoregressive audio models. Today we're stepping into **diffusion models for sound** — a completely different paradigm.\n\nHere's the key shift: instead of generating audio sample-by-sample (like WaveNet), diffusion models learn to **denoise**. They start with pure noise and gradually refine it into coherent audio.\n\n> Think of it like a sculptor starting with a rough block of marble and slowly chipping away to reveal the statue inside.\n\nWhat's your intuition about why this approach might be better for audio generation than autoregressive methods?" },
      { conversationId: conv.id, role: 'user', content: "I think maybe because audio is really long — like a 10 second clip at 44.1kHz is 441,000 samples. Generating each one sequentially would be super slow. Diffusion can maybe do it in parallel?" },
      { conversationId: conv.id, role: 'assistant', content: "**Exactly right.** That's one of the biggest practical advantages.\n\n---\n\n## Autoregressive vs Diffusion\n\n- **Autoregressive** (WaveNet): generates one sample at a time → 441,000 sequential steps for 10 seconds. Slow at inference.\n- **Diffusion**: generates the entire audio in parallel across a fixed number of denoising steps (typically 20-100). Each step refines ALL samples simultaneously.\n\nBut there's a deeper reason too. Diffusion models capture the **global structure** of audio better because they operate on the whole signal at once. Autoregressive models can lose track of long-range patterns.\n\n### How the denoising works:\n\n1. **Forward process**: gradually add Gaussian noise to real audio over $T$ steps until it's pure noise\n2. **Reverse process**: train a neural network to predict and remove the noise at each step\n3. **Generation**: start from random noise, apply the learned denoiser $T$ times\n\n$$x_{t-1} = \\frac{1}{\\sqrt{\\alpha_t}}\\left(x_t - \\frac{1-\\alpha_t}{\\sqrt{1-\\bar{\\alpha}_t}}\\epsilon_\\theta(x_t, t)\\right) + \\sigma_t z$$\n\nDon't worry about memorizing this equation — the intuition matters more. What part of this process is the neural network actually learning to do?" },
    ],
  })
}
