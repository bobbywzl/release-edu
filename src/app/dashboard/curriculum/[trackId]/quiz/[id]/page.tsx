'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Clock, CheckCircle, XCircle, Trophy, Send,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import WorkPage from '@/components/work-page'
import { useWorkData } from '@/lib/work-data'

export default function QuizPage() {
  const params = useParams()
  const trackId = params.trackId as string
  const id = params.id as string
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)

  const { data, loading } = useWorkData(trackId)
  const syllabus = data.syllabus
  const quizzes = data.quizzes

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-48" />
          <div className="h-4 bg-muted rounded w-96" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    )
  }

  if (!syllabus) return <div className="p-6 text-center text-muted-foreground">Subject not found.</div>

  const quiz = quizzes.find(q => q.id === id)
  if (!quiz) return <div className="p-6 text-center text-muted-foreground">Quiz not found.</div>

  const quizIdx = quizzes.findIndex(q => q.id === id)
  const prev = quizIdx > 0 ? quizzes[quizIdx - 1] : null
  const next = quizIdx < quizzes.length - 1 ? quizzes[quizIdx + 1] : null

  const currentQuestion = quiz.questions[currentQuestionIndex]
  const quizWorkContext = {
    type: 'quiz' as const,
    trackId,
    trackName: syllabus.title,
    itemId: quiz.id,
    itemTitle: quiz.title,
    content: `Quiz: ${quiz.title}\n\nCurrent Question (${currentQuestionIndex + 1}/${quiz.questions.length}): ${currentQuestion?.question ?? ''}\n\nType: ${currentQuestion?.type ?? ''}\n${currentQuestion?.options ? 'Options: ' + currentQuestion.options.join(', ') : ''}\n\nIMPORTANT: Do NOT reveal the answer. Guide the student's thinking.`,
  }

  return (
    <WorkPage
      type="quiz"
      trackId={trackId}
      trackName={syllabus.title}
      title={quiz.title}
      description={quiz.description}
      status={quiz.status}
      meta={[
        { label: 'Questions', value: String(quiz.questions.length) },
        { label: 'Points', value: String(quiz.totalPoints) },
        ...(quiz.timeLimit ? [{ label: 'Time limit', value: `${quiz.timeLimit} min` }] : []),
      ]}
      prevLink={prev ? { href: `/dashboard/curriculum/${trackId}/quiz/${prev.id}`, label: prev.title } : undefined}
      nextLink={next ? { href: `/dashboard/curriculum/${trackId}/quiz/${next.id}`, label: next.title } : undefined}
      workContext={quizWorkContext}
    >
      <QuizRunner quiz={quiz} currentQuestionIndex={currentQuestionIndex} onQuestionChange={setCurrentQuestionIndex} />
    </WorkPage>
  )
}

// ── Quiz Runner ────────────────────────────────────────────

import type { Quiz } from '@/types'

function QuizRunner({ quiz, currentQuestionIndex, onQuestionChange }: { quiz: Quiz; currentQuestionIndex: number; onQuestionChange: (idx: number) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(quiz.status === 'completed')

  const currentQ = currentQuestionIndex
  const setCurrentQ = onQuestionChange
  const questions = quiz.questions
  const q = questions[currentQ]
  const progress = ((currentQ + 1) / questions.length) * 100
  const isLast = currentQ === questions.length - 1

  function setAnswer(value: string) {
    setAnswers(prev => ({ ...prev, [q.id]: value }))
  }

  function handleSubmit() {
    setSubmitted(true)
    setCurrentQ(0)
  }

  // Calculate score
  const score = submitted
    ? questions.reduce((sum, question) => {
        const userAnswer = answers[question.id]
        if (question.correctAnswer && userAnswer === question.correctAnswer) {
          return sum + question.points
        }
        return sum
      }, 0)
    : 0

  // If quiz was already completed, use stored score
  const displayScore = quiz.status === 'completed' && quiz.score !== undefined ? quiz.score : score

  if (submitted) {
    return (
      <div className="space-y-4">
        {/* Score card */}
        <Card className="border-border">
          <CardContent className="p-5 text-center space-y-3">
            <Trophy className="w-10 h-10 mx-auto text-amber-400" />
            <div>
              <div className="text-2xl font-bold text-foreground">{displayScore}/{quiz.totalPoints}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {displayScore >= quiz.totalPoints * 0.8 ? 'Excellent work!' : displayScore >= quiz.totalPoints * 0.6 ? 'Good effort!' : 'Keep practicing!'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Review answers */}
        <div className="space-y-3">
          {questions.map((question, i) => {
            const userAnswer = answers[question.id]
            const isCorrect = question.correctAnswer ? userAnswer === question.correctAnswer : undefined
            return (
              <motion.div
                key={question.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className={`border-border ${isCorrect === true ? 'border-emerald-500/30' : isCorrect === false ? 'border-red-500/30' : ''}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      {isCorrect === true ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      ) : isCorrect === false ? (
                        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      ) : null}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground font-medium">Q{i + 1}: {question.question}</p>
                        {userAnswer && (
                          <p className={`text-xs mt-1 ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                            Your answer: {userAnswer}
                          </p>
                        )}
                        {!isCorrect && question.correctAnswer && (
                          <p className="text-xs text-emerald-400 mt-0.5">Correct: {question.correctAnswer}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2 italic">{question.explanation}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] flex-shrink-0">
                        {question.points} pts
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <Progress value={progress} className="h-2 flex-1" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {currentQ + 1}/{questions.length}
        </span>
      </div>

      {quiz.timeLimit && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          Time limit: {quiz.timeLimit} minutes
        </div>
      )}

      {/* Current question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={q.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15 }}
        >
          <Card className="border-border">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px] capitalize">{q.type.replace('-', ' ')}</Badge>
                <span className="text-[10px] text-muted-foreground">{q.points} pts</span>
              </div>

              <p className="text-sm font-medium text-foreground leading-relaxed">{q.question}</p>

              {/* Answer input */}
              {(q.type === 'multiple-choice' || q.type === 'true-false') && q.options && (
                <div className="space-y-2">
                  {q.options.map(opt => (
                    <label
                      key={opt}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        answers[q.id] === opt
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border hover:border-border/80 hover:bg-muted/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={opt}
                        checked={answers[q.id] === opt}
                        onChange={() => setAnswer(opt)}
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="text-sm text-foreground">{opt}</span>
                    </label>
                  ))}
                </div>
              )}

              {q.type === 'short-answer' && (
                <input
                  type="text"
                  value={answers[q.id] ?? ''}
                  onChange={e => setAnswer(e.target.value)}
                  placeholder="Type your answer..."
                  className="w-full bg-muted/30 border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              )}
            </CardContent>
          </Card>
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs gap-1"
          disabled={currentQ === 0}
          onClick={() => setCurrentQ(currentQ - 1)}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Previous
        </Button>

        {isLast ? (
          <Button
            size="sm"
            className="text-xs gap-1.5"
            onClick={handleSubmit}
          >
            <Send className="w-3.5 h-3.5" />
            Submit Quiz
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1"
            onClick={() => setCurrentQ(currentQ + 1)}
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
