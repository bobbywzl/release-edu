import prisma from '../src/lib/prisma'

const userId = '112687603494389110485'

async function main() {
  // Add foundation/core tracks
  const linearAlgebra = await prisma.track.create({
    data: {
      userId,
      name: 'Linear Algebra & Mathematics',
      description: 'Mathematical foundations essential for quantum computing and cryptography',
      color: '#8B5CF6',
      type: 'core',
      order: 10,
    }
  })
  
  await prisma.chapter.createMany({
    data: [
      { trackId: linearAlgebra.id, title: 'Vectors and Vector Spaces', description: 'Foundations of vector mathematics', keyTopics: JSON.stringify(['vectors', 'basis', 'linear independence']), estimatedMinutes: 45, content: '# Vectors and Vector Spaces\n\nVectors are the mathematical backbone of quantum computing. Every qubit state is a vector in a complex vector space called a Hilbert space.\n\n## Key Concepts\n- Vectors as ordered lists of numbers\n- Vector addition and scalar multiplication\n- Linear independence and basis sets\n- Inner products and orthogonality\n\nUnderstanding these concepts is essential before studying quantum gates and quantum algorithms.', status: 'not-started', order: 0 },
      { trackId: linearAlgebra.id, title: 'Matrices and Linear Transformations', description: 'Matrix operations as quantum gates', keyTopics: JSON.stringify(['matrix multiplication', 'eigenvalues', 'unitary matrices']), estimatedMinutes: 60, content: '# Matrices and Linear Transformations\n\nQuantum gates ARE matrices. Every operation on a qubit is a matrix multiplication. This chapter bridges abstract matrix math to quantum circuits.\n\n## Key Concepts\n- Matrix multiplication and composition\n- Eigenvalues and eigenvectors\n- Unitary matrices (the class quantum gates belong to)\n- Determinants and inverses\n\nWhen you compute a quantum gate, you are multiplying matrices.', status: 'not-started', order: 1 },
      { trackId: linearAlgebra.id, title: 'Complex Numbers & Probability', description: 'Probability amplitudes and complex math in QC', keyTopics: JSON.stringify(['complex numbers', 'probability', 'Born rule']), estimatedMinutes: 45, content: '# Complex Numbers & Probability\n\nQuantum states use complex number amplitudes. The probability of measuring a state is the squared magnitude of its amplitude.\n\n## Key Concepts\n- Complex numbers: real + imaginary parts\n- Modulus and argument\n- Probability from amplitudes (Born rule)\n- Interference: why quantum computers are powerful', status: 'not-started', order: 2 },
    ]
  })

  const csFoundations = await prisma.track.create({
    data: {
      userId,
      name: 'Computer Science Fundamentals',
      description: 'Core CS concepts needed for building the quantum API platform',
      color: '#10B981',
      type: 'core',
      order: 11,
    }
  })
  
  await prisma.chapter.createMany({
    data: [
      { trackId: csFoundations.id, title: 'Algorithms & Complexity', description: 'Big O notation, NP problems, and quantum advantage', keyTopics: JSON.stringify(['Big O', 'P vs NP', 'computational complexity']), estimatedMinutes: 60, content: '# Algorithms & Complexity\n\nUnderstanding why quantum computers are faster requires understanding classical complexity theory. The famous P vs NP problem is exactly what quantum computing attacks.\n\n## Key Concepts\n- Big O notation for algorithm analysis\n- P, NP, and NP-complete problems\n- Why some problems are "exponentially hard" for classical computers\n- Where quantum algorithms provide exponential speedup (Shor, Grover)', status: 'not-started', order: 0 },
      { trackId: csFoundations.id, title: 'Data Structures', description: 'Efficient data structures for algorithm implementation', keyTopics: JSON.stringify(['arrays', 'graphs', 'trees', 'hash maps']), estimatedMinutes: 45, content: '# Data Structures\n\nBuilding an API platform requires choosing the right data structures. This chapter covers the essentials.\n\n## Key Concepts\n- Arrays, linked lists, stacks, queues\n- Trees and graphs (used in quantum circuit DAGs)\n- Hash maps for efficient lookups\n- When to use each structure', status: 'not-started', order: 1 },
      { trackId: csFoundations.id, title: 'REST APIs & System Design', description: 'Building the quantum algorithm API platform', keyTopics: JSON.stringify(['REST', 'API design', 'authentication', 'scalability']), estimatedMinutes: 60, content: '# REST APIs & System Design\n\nYour goal is a quantum algorithm API platform. This chapter teaches you to build production-grade APIs.\n\n## Key Concepts\n- REST principles and HTTP methods\n- API authentication (API keys, JWT)\n- Rate limiting and error handling\n- System design for scalability\n- How to expose quantum circuits as an API endpoint', status: 'not-started', order: 2 },
    ]
  })

  console.log('✅ Added foundation tracks:', linearAlgebra.name, csFoundations.name)
  await prisma.$disconnect()
}

main().catch(console.error)
