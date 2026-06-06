import type {
  SubjectSyllabus,
  Homework,
  Quiz,
  SubjectProject,
} from '@/types'

// ── Computer Science (track-cs) ────────────────────────────

const csSyllabus: SubjectSyllabus = {
  trackId: 'track-cs',
  title: 'Computer Science',
  description: 'Programming fundamentals, computational thinking, and digital literacy',
  chapters: [
    {
      id: 'cs-ch-1',
      trackId: 'track-cs',
      title: 'Variables, Types & Control Flow',
      description: 'The building blocks of every program — storing data and making decisions.',
      order: 1,
      status: 'completed',
      estimatedMinutes: 45,
      keyTopics: ['Variables & data types', 'Conditionals', 'Loops'],
      content: `## Variables & Data Types

Every program needs to store information. Variables are named containers that hold values — numbers, text, booleans, and more. In Python, you don't need to declare a type explicitly; the interpreter figures it out.

\`\`\`python
name = "Ada"       # string
age = 17           # integer
gpa = 3.95         # float
is_enrolled = True # boolean
\`\`\`

## Control Flow

Programs aren't just lists of instructions — they make decisions. **Conditionals** (if/elif/else) let your code branch, and **loops** (for/while) let it repeat. Mastering control flow is the first real step toward computational thinking.

Understanding when to use a \`for\` loop vs a \`while\` loop, or how to nest conditionals cleanly, separates beginners from intermediate programmers.`,
    },
    {
      id: 'cs-ch-2',
      trackId: 'track-cs',
      title: 'Functions & Modular Design',
      description: 'Breaking problems into reusable pieces with functions and modules.',
      order: 2,
      status: 'completed',
      estimatedMinutes: 50,
      keyTopics: ['Function definitions', 'Parameters & return values', 'Scope'],
      content: `## Why Functions?

As programs grow, repeating code becomes a maintenance nightmare. Functions let you encapsulate a behavior once and call it many times. They make code readable, testable, and reusable.

\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}! Welcome aboard."
\`\`\`

## Scope & Side Effects

Variables inside a function live in their own "scope" — they don't leak out. Understanding scope prevents some of the most confusing bugs new programmers encounter. A **pure function** has no side effects: same input always gives same output.

## Modular Design

Good software is a collection of small, focused modules. Each module (file) exports functions and classes that other modules import. This separation of concerns is the foundation of professional software engineering.`,
    },
    {
      id: 'cs-ch-3',
      trackId: 'track-cs',
      title: 'Data Structures: Lists, Dicts & Sets',
      description: 'Organizing data efficiently with Python\'s core collections.',
      order: 3,
      status: 'in-progress',
      estimatedMinutes: 55,
      keyTopics: ['Lists & tuples', 'Dictionaries', 'Sets & iteration'],
      content: `## Lists

A list is an ordered, mutable sequence. You can append, remove, sort, slice, and iterate. Lists are the workhorse of Python data handling.

\`\`\`python
scores = [92, 87, 95, 78]
scores.append(88)
top = max(scores)  # 95
\`\`\`

## Dictionaries

Dicts map keys to values — think of them as lookup tables. They're O(1) for access, making them ideal for counting, grouping, and caching.

## Sets

Sets store unique elements with fast membership testing. They're perfect for removing duplicates and computing intersections or unions between groups.`,
    },
    {
      id: 'cs-ch-4',
      trackId: 'track-cs',
      title: 'Object-Oriented Programming',
      description: 'Modeling real-world concepts with classes, inheritance, and polymorphism.',
      order: 4,
      status: 'not-started',
      estimatedMinutes: 60,
      keyTopics: ['Classes & objects', 'Inheritance', 'Encapsulation'],
      content: `## Classes & Objects

A class is a blueprint; an object is a specific instance built from that blueprint. OOP lets you model real-world entities — a Player, an Enemy, an Inventory — with attributes (data) and methods (behavior).

\`\`\`python
class Player:
    def __init__(self, name: str, hp: int = 100):
        self.name = name
        self.hp = hp

    def take_damage(self, amount: int):
        self.hp = max(0, self.hp - amount)
\`\`\`

## Inheritance & Polymorphism

Inheritance lets you create specialized versions of a class. A \`Wizard\` can inherit from \`Player\` and add magic-specific behavior. Polymorphism means different classes can respond to the same method call in different ways — a powerful design tool.`,
    },
    {
      id: 'cs-ch-5',
      trackId: 'track-cs',
      title: 'Algorithms & Problem Solving',
      description: 'Thinking algorithmically — sorting, searching, and analyzing efficiency.',
      order: 5,
      status: 'not-started',
      estimatedMinutes: 50,
      keyTopics: ['Sorting algorithms', 'Binary search', 'Big-O notation'],
      content: `## What Is an Algorithm?

An algorithm is a step-by-step procedure for solving a problem. Every time you follow a recipe or give directions, you're executing an algorithm. In CS, we study algorithms formally to find efficient solutions.

## Sorting & Searching

Sorting data makes searching fast. **Bubble sort** is simple but slow (O(n²)); **merge sort** is elegant and fast (O(n log n)). **Binary search** on sorted data is O(log n) — halving the problem space each step.

## Big-O Notation

Big-O describes how an algorithm scales. It's not about exact speed — it's about growth rate. Understanding Big-O helps you choose the right approach before writing a single line of code.`,
    },
  ],
}

const csHomework: Homework[] = [
  {
    id: 'cs-hw-1',
    trackId: 'track-cs',
    chapterId: 'cs-ch-1',
    title: 'Control Flow Challenge',
    description: 'Write a program that uses conditionals and loops to solve a series of mini-problems.',
    instructions: 'Complete all 5 exercises in the starter file. Each exercise practices a different control flow pattern — nested ifs, while loops with break, for loops with enumerate. Submit your .py file when done.',
    status: 'completed',
    dueDate: '2026-03-20',
    competencies: ['Control flow', 'Logical reasoning', 'Python syntax'],
    estimatedMinutes: 30,
  },
  {
    id: 'cs-hw-2',
    trackId: 'track-cs',
    chapterId: 'cs-ch-2',
    title: 'Build a Utility Library',
    description: 'Create a module of reusable helper functions.',
    instructions: 'Write at least 6 pure functions that handle common tasks (string formatting, list manipulation, math helpers). Each function must have a docstring and at least 2 test cases. Export them from a single module.',
    status: 'in-progress',
    dueDate: '2026-03-28',
    competencies: ['Functions', 'Modular design', 'Testing'],
    estimatedMinutes: 45,
  },
  {
    id: 'cs-hw-3',
    trackId: 'track-cs',
    chapterId: 'cs-ch-3',
    title: 'Data Structure Drills',
    description: 'Solve 8 problems that require choosing the right data structure.',
    instructions: 'For each problem, pick the most appropriate data structure (list, dict, set, or tuple) and justify your choice in a comment. Problems range from frequency counting to deduplication to nested lookups.',
    status: 'not-started',
    dueDate: '2026-04-04',
    competencies: ['Data structures', 'Problem solving', 'Code efficiency'],
    estimatedMinutes: 40,
  },
  {
    id: 'cs-hw-4',
    trackId: 'track-cs',
    chapterId: 'cs-ch-4',
    title: 'Design a Class Hierarchy',
    description: 'Model a game entity system using OOP principles.',
    instructions: 'Design a base Entity class with at least 2 subclasses (e.g., Player and Enemy). Implement shared methods in the base class and specialized behaviors in subclasses. Include a short UML-style diagram as a comment.',
    status: 'not-started',
    competencies: ['OOP', 'Inheritance', 'Software design'],
    estimatedMinutes: 40,
  },
]

const csQuizzes: Quiz[] = [
  {
    id: 'cs-quiz-1',
    trackId: 'track-cs',
    chapterId: 'cs-ch-1',
    title: 'Variables & Control Flow Quiz',
    description: 'Test your understanding of Python basics and control flow.',
    status: 'completed',
    score: 18,
    totalPoints: 20,
    completedAt: '2026-03-18T14:30:00Z',
    timeLimit: 15,
    questions: [
      {
        id: 'cs-q-1-1',
        question: 'What is the output of: print(type(3.14))?',
        type: 'multiple-choice',
        options: ["<class 'int'>", "<class 'float'>", "<class 'str'>", "<class 'number'>"],
        correctAnswer: "<class 'float'>",
        explanation: '3.14 has a decimal point, making it a float in Python.',
        points: 4,
      },
      {
        id: 'cs-q-1-2',
        question: 'A while loop always executes at least once.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'False',
        explanation: 'A while loop checks its condition before the first iteration. If the condition is False initially, the body never executes.',
        points: 4,
      },
      {
        id: 'cs-q-1-3',
        question: 'Which keyword exits a loop immediately?',
        type: 'multiple-choice',
        options: ['continue', 'break', 'return', 'pass'],
        correctAnswer: 'break',
        explanation: '`break` exits the innermost loop. `continue` skips to the next iteration. `return` exits a function. `pass` does nothing.',
        points: 4,
      },
      {
        id: 'cs-q-1-4',
        question: 'In Python, variable names are case-sensitive.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'True',
        explanation: '`myVar` and `myvar` are two different variables in Python.',
        points: 4,
      },
      {
        id: 'cs-q-1-5',
        question: 'What does `elif` stand for?',
        type: 'multiple-choice',
        options: ['else if', 'element if', 'elevated if', 'else input'],
        correctAnswer: 'else if',
        explanation: '`elif` is Python\'s shorthand for "else if" — it checks another condition when the previous one was False.',
        points: 4,
      },
    ],
  },
  {
    id: 'cs-quiz-2',
    trackId: 'track-cs',
    chapterId: 'cs-ch-3',
    title: 'Data Structures Quiz',
    description: 'Lists, dictionaries, and sets — pick the right tool for the job.',
    status: 'not-started',
    totalPoints: 20,
    timeLimit: 15,
    questions: [
      {
        id: 'cs-q-2-1',
        question: 'Which data structure uses key-value pairs?',
        type: 'multiple-choice',
        options: ['List', 'Tuple', 'Dictionary', 'Set'],
        correctAnswer: 'Dictionary',
        explanation: 'Dictionaries (dicts) store data as key-value pairs, allowing O(1) lookups by key.',
        points: 5,
      },
      {
        id: 'cs-q-2-2',
        question: 'Sets can contain duplicate elements.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'False',
        explanation: 'Sets automatically remove duplicates. Each element appears at most once.',
        points: 5,
      },
      {
        id: 'cs-q-2-3',
        question: 'What does `my_list[1:3]` return for `[10, 20, 30, 40]`?',
        type: 'multiple-choice',
        options: ['[10, 20]', '[20, 30]', '[20, 30, 40]', '[10, 20, 30]'],
        correctAnswer: '[20, 30]',
        explanation: 'Slicing is inclusive of the start index (1) and exclusive of the end index (3), giving elements at indices 1 and 2.',
        points: 5,
      },
      {
        id: 'cs-q-2-4',
        question: 'Tuples are immutable (cannot be changed after creation).',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'True',
        explanation: 'Once created, a tuple\'s elements cannot be modified, added, or removed. Use a list if you need mutability.',
        points: 5,
      },
    ],
  },
  {
    id: 'cs-quiz-3',
    trackId: 'track-cs',
    chapterId: 'cs-ch-2',
    title: 'Functions & Scope Quiz',
    description: 'Test your knowledge of function design and variable scope.',
    status: 'not-started',
    totalPoints: 15,
    timeLimit: 10,
    questions: [
      {
        id: 'cs-q-3-1',
        question: 'A function without a return statement returns:',
        type: 'multiple-choice',
        options: ['0', 'None', 'An empty string', 'An error'],
        correctAnswer: 'None',
        explanation: 'In Python, if a function doesn\'t explicitly return a value, it implicitly returns None.',
        points: 5,
      },
      {
        id: 'cs-q-3-2',
        question: 'A variable defined inside a function is accessible outside it.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'False',
        explanation: 'Variables defined inside a function have local scope and are not accessible outside the function body.',
        points: 5,
      },
      {
        id: 'cs-q-3-3',
        question: 'What is the term for a function that calls itself?',
        type: 'multiple-choice',
        options: ['Iterative', 'Recursive', 'Nested', 'Closure'],
        correctAnswer: 'Recursive',
        explanation: 'Recursion is when a function calls itself to break a problem into smaller sub-problems.',
        points: 5,
      },
    ],
  },
]

const csProject: SubjectProject = {
  id: 'cs-proj-1',
  trackId: 'track-cs',
  title: 'Build an Adaptive Difficulty Game',
  description: 'Create a terminal-based game that adjusts its difficulty based on player performance using data structures and OOP.',
  proposal: 'I want to build a text-based dungeon crawler where enemy difficulty scales with the player\'s win rate. If the player wins too easily, enemies get stronger stats and new abilities. If the player struggles, the game offers power-ups and weaker encounters. I\'ll track performance using dictionaries and implement the game entities with classes.',
  status: 'in-progress',
  progress: 35,
  tasks: [
    { id: 'cs-t-1', title: 'Design game entity class hierarchy (Player, Enemy, Item)', completed: true, order: 1 },
    { id: 'cs-t-2', title: 'Implement combat system with turn-based logic', completed: true, order: 2 },
    { id: 'cs-t-3', title: 'Build performance tracking with rolling win rate', completed: false, order: 3 },
    { id: 'cs-t-4', title: 'Create adaptive difficulty algorithm', completed: false, order: 4 },
    { id: 'cs-t-5', title: 'Add dungeon generation with randomized rooms', completed: false, order: 5 },
    { id: 'cs-t-6', title: 'Polish, playtest, and write project reflection', completed: false, order: 6 },
  ],
  milestones: [
    { id: 'cs-m-1', title: 'Core classes & combat working', date: new Date('2026-03-15'), completed: true },
    { id: 'cs-m-2', title: 'Difficulty adaptation functional', date: new Date('2026-04-01'), completed: false },
    { id: 'cs-m-3', title: 'Full dungeon playable', date: new Date('2026-04-12'), completed: false },
    { id: 'cs-m-4', title: 'Final demo & reflection submitted', date: new Date('2026-04-20'), completed: false },
  ],
  coverageMap: ['Variables & data types', 'Functions', 'Data structures', 'OOP', 'Algorithms'],
  mentorFeedback: 'Great concept! The adaptive difficulty idea shows creative thinking. Focus on getting the tracking system right before adding dungeon generation.',
}

// ── Mathematics (track-math) ───────────────────────────────

const mathSyllabus: SubjectSyllabus = {
  trackId: 'track-math',
  title: 'Mathematics',
  description: 'Foundations in algebra, geometry, statistics, and logical reasoning',
  chapters: [
    {
      id: 'math-ch-1',
      trackId: 'track-math',
      title: 'Algebraic Expressions & Equations',
      description: 'Manipulating expressions, solving equations, and understanding equivalence.',
      order: 1,
      status: 'completed',
      estimatedMinutes: 45,
      keyTopics: ['Simplifying expressions', 'Solving linear equations', 'Word problems'],
      content: `## Algebraic Expressions

An algebraic expression combines numbers, variables, and operations. Simplifying means combining like terms: \`3x + 2x = 5x\`. Distributing means expanding: \`2(x + 3) = 2x + 6\`.

## Solving Equations

An equation states that two expressions are equal. Solving means finding the value of the variable that makes it true. The golden rule: whatever you do to one side, do to the other.

\`\`\`
2x + 5 = 13
2x = 8
x = 4
\`\`\`

## Word Problems

The hardest part of algebra isn't the math — it's translating English into equations. Practice identifying the unknown, setting up the equation, and checking your answer in context.`,
    },
    {
      id: 'math-ch-2',
      trackId: 'track-math',
      title: 'Functions & Graphing',
      description: 'Understanding functions as input-output machines and visualizing them.',
      order: 2,
      status: 'in-progress',
      estimatedMinutes: 50,
      keyTopics: ['Function notation', 'Linear functions', 'Graphing & slope'],
      content: `## What Is a Function?

A function is a rule that assigns exactly one output to each input. We write f(x) = 2x + 1, meaning "for any input x, double it and add 1." Functions are everywhere — converting temperatures, calculating tips, modeling growth.

## Linear Functions & Slope

A linear function graphs as a straight line: y = mx + b. The slope (m) measures steepness — rise over run. The y-intercept (b) is where the line crosses the y-axis. Two points define a line; slope describes its direction.

## Reading Graphs

A graph tells a story. The x-axis is usually the input (time, quantity), the y-axis is the output. Increasing sections slope up; decreasing sections slope down. Flat sections mean no change.`,
    },
    {
      id: 'math-ch-3',
      trackId: 'track-math',
      title: 'Statistics & Data Analysis',
      description: 'Collecting, summarizing, and interpreting data to make decisions.',
      order: 3,
      status: 'not-started',
      estimatedMinutes: 50,
      keyTopics: ['Mean, median, mode', 'Standard deviation', 'Data visualization'],
      content: `## Measures of Center

The **mean** (average) adds all values and divides by count. The **median** is the middle value when sorted. The **mode** is the most frequent. Each tells a different story — the mean is sensitive to outliers, the median is robust.

## Spread & Variation

**Range** (max − min) gives a rough sense of spread. **Standard deviation** measures how far values typically are from the mean. A small SD means data clusters tightly; a large SD means wide spread.

## Visualizing Data

Histograms show distribution shape. Box plots reveal quartiles and outliers. Scatter plots show relationships between two variables. Choosing the right visualization is a skill in itself.`,
    },
    {
      id: 'math-ch-4',
      trackId: 'track-math',
      title: 'Probability & Decision Making',
      description: 'Quantifying uncertainty and making informed choices under risk.',
      order: 4,
      status: 'not-started',
      estimatedMinutes: 45,
      keyTopics: ['Basic probability', 'Expected value', 'Conditional probability'],
      content: `## Basic Probability

Probability measures how likely an event is, from 0 (impossible) to 1 (certain). For equally likely outcomes: P(event) = favorable outcomes / total outcomes. Flipping heads: 1/2. Rolling a 6: 1/6.

## Expected Value

Expected value combines probability with payoff. If a game pays $10 with probability 0.3 and $0 otherwise, the expected value is $3. It's the long-run average — essential for evaluating bets, investments, and decisions.

## Conditional Probability

P(A|B) is the probability of A given that B has occurred. It narrows the sample space. Bayes' theorem connects P(A|B) to P(B|A) — a powerful tool for updating beliefs with new evidence.`,
    },
  ],
}

const mathHomework: Homework[] = [
  {
    id: 'math-hw-1',
    trackId: 'track-math',
    chapterId: 'math-ch-1',
    title: 'Equation Solving Practice',
    description: 'Solve a set of increasingly complex linear equations.',
    instructions: 'Complete all 12 equations. Show your work for each step. For the last 3 word problems, write the equation before solving. Check each answer by substituting back.',
    status: 'completed',
    dueDate: '2026-03-18',
    competencies: ['Linear equations', 'Algebraic manipulation', 'Problem translation'],
    estimatedMinutes: 25,
  },
  {
    id: 'math-hw-2',
    trackId: 'track-math',
    chapterId: 'math-ch-2',
    title: 'Graph Analysis Worksheet',
    description: 'Analyze and create graphs of linear functions.',
    instructions: 'For each of the 6 functions, calculate the slope and y-intercept, then sketch the graph. For the 3 provided graphs, write the equation of the line. Use graph paper or a graphing tool.',
    status: 'in-progress',
    dueDate: '2026-03-30',
    competencies: ['Graphing', 'Slope calculation', 'Function analysis'],
    estimatedMinutes: 35,
  },
  {
    id: 'math-hw-3',
    trackId: 'track-math',
    chapterId: 'math-ch-3',
    title: 'Data Analysis Mini-Project',
    description: 'Analyze a dataset and present your findings with visualizations.',
    instructions: 'Using the provided dataset of 50 student test scores, calculate mean, median, mode, range, and standard deviation. Create a histogram and box plot. Write a 1-paragraph summary of what the data reveals.',
    status: 'not-started',
    dueDate: '2026-04-06',
    competencies: ['Descriptive statistics', 'Data visualization', 'Written analysis'],
    estimatedMinutes: 45,
  },
]

const mathQuizzes: Quiz[] = [
  {
    id: 'math-quiz-1',
    trackId: 'track-math',
    chapterId: 'math-ch-1',
    title: 'Algebra Fundamentals Quiz',
    description: 'Test your equation-solving and expression-simplifying skills.',
    status: 'completed',
    score: 16,
    totalPoints: 20,
    completedAt: '2026-03-17T10:00:00Z',
    timeLimit: 12,
    questions: [
      {
        id: 'math-q-1-1',
        question: 'Simplify: 3(2x + 4) - 2x',
        type: 'multiple-choice',
        options: ['4x + 12', '4x + 4', '8x + 12', '6x + 12'],
        correctAnswer: '4x + 12',
        explanation: '3(2x + 4) = 6x + 12. Then 6x + 12 - 2x = 4x + 12.',
        points: 5,
      },
      {
        id: 'math-q-1-2',
        question: 'Solve for x: 5x - 3 = 2x + 9',
        type: 'multiple-choice',
        options: ['x = 2', 'x = 4', 'x = 3', 'x = 6'],
        correctAnswer: 'x = 4',
        explanation: '5x - 2x = 9 + 3 → 3x = 12 → x = 4.',
        points: 5,
      },
      {
        id: 'math-q-1-3',
        question: 'If x = -2, then x² = -4.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'False',
        explanation: 'x² = (-2)² = 4, not -4. Squaring a negative number gives a positive result.',
        points: 5,
      },
      {
        id: 'math-q-1-4',
        question: 'The equation 0 = 0 has no solution.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'False',
        explanation: '0 = 0 is always true, meaning the original equation has infinitely many solutions (it\'s an identity).',
        points: 5,
      },
    ],
  },
  {
    id: 'math-quiz-2',
    trackId: 'track-math',
    chapterId: 'math-ch-2',
    title: 'Functions & Graphing Quiz',
    description: 'Slope, intercepts, and function notation.',
    status: 'not-started',
    totalPoints: 20,
    timeLimit: 15,
    questions: [
      {
        id: 'math-q-2-1',
        question: 'What is the slope of y = -3x + 7?',
        type: 'multiple-choice',
        options: ['7', '-3', '3', '-7'],
        correctAnswer: '-3',
        explanation: 'In y = mx + b form, m is the slope. Here m = -3.',
        points: 5,
      },
      {
        id: 'math-q-2-2',
        question: 'A vertical line is a function.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'False',
        explanation: 'A vertical line fails the vertical line test — one input maps to multiple outputs, so it\'s not a function.',
        points: 5,
      },
      {
        id: 'math-q-2-3',
        question: 'If f(x) = x² + 1, what is f(3)?',
        type: 'multiple-choice',
        options: ['7', '10', '9', '4'],
        correctAnswer: '10',
        explanation: 'f(3) = 3² + 1 = 9 + 1 = 10.',
        points: 5,
      },
      {
        id: 'math-q-2-4',
        question: 'Two parallel lines have the same slope.',
        type: 'true-false',
        options: ['True', 'False'],
        correctAnswer: 'True',
        explanation: 'Parallel lines never intersect because they have identical slopes but different y-intercepts.',
        points: 5,
      },
    ],
  },
]

const mathProject: SubjectProject = {
  id: 'math-proj-1',
  trackId: 'track-math',
  title: 'Statistical Analysis of Real-World Dataset',
  description: 'Choose a real-world dataset, perform statistical analysis, and present findings with visualizations and written interpretation.',
  proposal: 'I want to analyze NBA player statistics from the current season to find which metrics best predict team wins. I\'ll use descriptive statistics, correlation analysis, and data visualization to explore the relationship between individual player performance and team outcomes.',
  status: 'approved',
  progress: 15,
  tasks: [
    { id: 'math-t-1', title: 'Find and clean the dataset (NBA stats API or CSV)', completed: true, order: 1 },
    { id: 'math-t-2', title: 'Calculate descriptive statistics for key metrics', completed: false, order: 2 },
    { id: 'math-t-3', title: 'Create visualizations (histograms, scatter plots, box plots)', completed: false, order: 3 },
    { id: 'math-t-4', title: 'Compute correlations between player stats and team wins', completed: false, order: 4 },
    { id: 'math-t-5', title: 'Write analysis report with findings and conclusions', completed: false, order: 5 },
  ],
  milestones: [
    { id: 'math-m-1', title: 'Dataset selected and cleaned', date: new Date('2026-03-22'), completed: true },
    { id: 'math-m-2', title: 'Descriptive stats and visualizations complete', date: new Date('2026-04-05'), completed: false },
    { id: 'math-m-3', title: 'Correlation analysis done', date: new Date('2026-04-14'), completed: false },
    { id: 'math-m-4', title: 'Final report submitted', date: new Date('2026-04-22'), completed: false },
  ],
  coverageMap: ['Mean, median, mode', 'Standard deviation', 'Data visualization', 'Graphing & slope'],
}

// ── Exports ────────────────────────────────────────────────

export const demoSyllabi: Record<string, SubjectSyllabus> = {
  'track-cs': csSyllabus,
  'track-math': mathSyllabus,
}

export const demoHomework: Record<string, Homework[]> = {
  'track-cs': csHomework,
  'track-math': mathHomework,
}

export const demoQuizzes: Record<string, Quiz[]> = {
  'track-cs': csQuizzes,
  'track-math': mathQuizzes,
}

export const demoProjects: Record<string, SubjectProject> = {
  'track-cs': csProject,
  'track-math': mathProject,
}
