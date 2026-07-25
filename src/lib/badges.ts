/**
 * Badge catalog + evaluator — the achievement layer of the XP system.
 *
 * Design (borrowed from what demonstrably retains users):
 * - Duolingo: tiered streak milestones + loss-aversion framing
 * - Khan Academy: badge ladders per activity type (meteorite → black hole)
 * - Xbox/PSN: rarity tiers (bronze/silver/gold/legendary) make higher
 *   badges feel earned, and the *next* locked badge is always visible
 *
 * Badges are computed from durable stats (never revoked): the evaluator
 * compares stats against every definition and persists newly crossed ones
 * to UserBadge. Streak badges use longestStreak so a broken streak keeps
 * its trophies — the streak itself is the daily pressure, badges are the
 * permanent record.
 *
 * All names/descriptions are bilingual (EN/ZH) — badge text appears in the
 * dashboard, unlock celebrations, and the portfolio/résumé.
 */
import prisma from '@/lib/prisma'
import { parseQuizState } from '@/lib/mastery'

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'legendary'

export interface BadgeDef {
  id: string
  tier: BadgeTier
  /** Emoji medal — renders identically everywhere incl. PDF export. */
  icon: string
  /** Which stat unlocks it + the threshold. */
  metric: keyof BadgeStats
  target: number
  name: { en: string; zh: string }
  /** Written to read as competency evidence on a résumé, not as game fluff. */
  desc: { en: string; zh: string }
}

export interface BadgeStats {
  longestStreak: number
  chaptersCompleted: number
  tracksCompleted: number
  projectsCompleted: number
  xp: number
  // Tree EDU units of progress: checkpoint-verified nodes and fully
  // mastered problem trees.
  nodesVerified: number
  treesCompleted: number
  // ── Purpose-native metrics (what Tree EDU actually values) ──
  /** Own-words short answers judged correct — transfer, not recitation. */
  ownWordsCorrect: number
  /** Answers marked "sure" that WERE right — calibrated self-knowledge. */
  confidentCorrect: number
  /** Verified nodes the student came back to and re-proved (reviewedAt). */
  reviewedNodes: number
  /** Non-seed nodes — grown from the student's own questions/asks/hands. */
  selfGrownNodes: number
  /** Active insights in Bob's constellation about this learner. */
  insightCount: number
  /** Files attached as learning evidence (tree + node scope). */
  filesAttached: number
}

export const BADGES: BadgeDef[] = [
  // ── Consistency (streak) ──
  { id: 'streak_3',   tier: 'bronze',    icon: '🔥', metric: 'longestStreak', target: 3,
    name: { en: 'Kindling',          zh: '星火' },
    desc: { en: '3-day learning streak',                zh: '连续学习 3 天' } },
  { id: 'streak_7',   tier: 'silver',    icon: '🔥', metric: 'longestStreak', target: 7,
    name: { en: 'Week of Fire',      zh: '七日之火' },
    desc: { en: '7 consecutive days of learning',       zh: '连续学习 7 天' } },
  { id: 'streak_30',  tier: 'gold',      icon: '🔥', metric: 'longestStreak', target: 30,
    name: { en: 'Month of Momentum', zh: '三十日恒心' },
    desc: { en: '30 consecutive days of learning',      zh: '连续学习 30 天' } },
  { id: 'streak_100', tier: 'legendary', icon: '☄️', metric: 'longestStreak', target: 100,
    name: { en: 'Centurion',         zh: '百日传奇' },
    desc: { en: '100 consecutive days of learning',     zh: '连续学习 100 天' } },

  // ── Mastery (chapters) ──
  { id: 'ch_1',  tier: 'bronze', icon: '📖', metric: 'chaptersCompleted', target: 1,
    name: { en: 'First Steps',       zh: '启程' },
    desc: { en: 'Mastered the first chapter',           zh: '完成第一章的学习' } },
  { id: 'ch_5',  tier: 'silver', icon: '📚', metric: 'chaptersCompleted', target: 5,
    name: { en: 'Pathfinder',        zh: '探路者' },
    desc: { en: 'Mastered 5 chapters',                  zh: '完成 5 个章节' } },
  { id: 'ch_10', tier: 'gold',   icon: '🎓', metric: 'chaptersCompleted', target: 10,
    name: { en: 'Knowledge Builder', zh: '知识建造者' },
    desc: { en: 'Mastered 10 chapters',                 zh: '完成 10 个章节' } },
  { id: 'ch_25', tier: 'legendary', icon: '🏛️', metric: 'chaptersCompleted', target: 25,
    name: { en: 'Scholar',           zh: '学者' },
    desc: { en: 'Mastered 25 chapters',                 zh: '完成 25 个章节' } },

  // ── Completion (courses) ──
  { id: 'track_1', tier: 'gold',      icon: '🏆', metric: 'tracksCompleted', target: 1,
    name: { en: 'Course Conqueror',  zh: '课程征服者' },
    desc: { en: 'Completed an entire course',           zh: '完整修完一门课程' } },
  { id: 'track_3', tier: 'legendary', icon: '👑', metric: 'tracksCompleted', target: 3,
    name: { en: 'Polymath',          zh: '博学者' },
    desc: { en: 'Completed 3 entire courses',           zh: '完整修完 3 门课程' } },

  // ── Building (projects) ──
  { id: 'proj_1', tier: 'silver', icon: '🔨', metric: 'projectsCompleted', target: 1,
    name: { en: 'Maker',             zh: '创作者' },
    desc: { en: 'Shipped a real project end-to-end',    zh: '完整交付一个实践项目' } },
  { id: 'proj_3', tier: 'gold',   icon: '🚀', metric: 'projectsCompleted', target: 3,
    name: { en: 'Serial Builder',    zh: '连续创造者' },
    desc: { en: 'Shipped 3 real projects',              zh: '完整交付 3 个实践项目' } },

  // ── Verified understanding (tree nodes — the Tree EDU core unit) ──
  { id: 'node_1',  tier: 'bronze', icon: '🌱', metric: 'nodesVerified', target: 1,
    name: { en: 'First Sprout',      zh: '初芽' },
    desc: { en: 'Verified understanding of a first tree node',  zh: '首次通过检查题验证一个节点' } },
  { id: 'node_10', tier: 'silver', icon: '🌿', metric: 'nodesVerified', target: 10,
    name: { en: 'Branch Builder',    zh: '枝干建造者' },
    desc: { en: 'Verified understanding of 10 tree nodes',      zh: '验证掌握 10 个节点' } },
  { id: 'node_25', tier: 'gold',   icon: '🌳', metric: 'nodesVerified', target: 25,
    name: { en: 'Canopy Grower',     zh: '树冠培育者' },
    desc: { en: 'Verified understanding of 25 tree nodes',      zh: '验证掌握 25 个节点' } },
  { id: 'node_50', tier: 'legendary', icon: '🌲', metric: 'nodesVerified', target: 50,
    name: { en: 'Old-Growth Mind',   zh: '参天心智' },
    desc: { en: 'Verified understanding of 50 tree nodes',      zh: '验证掌握 50 个节点' } },

  // ── Problem mastery (whole trees) ──
  { id: 'tree_1', tier: 'gold',      icon: '🏆', metric: 'treesCompleted', target: 1,
    name: { en: 'Problem Master',    zh: '问题大师' },
    desc: { en: 'Mastered an entire problem tree end-to-end',   zh: '完整掌握一整棵问题树' } },
  { id: 'tree_3', tier: 'legendary', icon: '👑', metric: 'treesCompleted', target: 3,
    name: { en: 'Forest Sovereign',  zh: '森林之主' },
    desc: { en: 'Mastered 3 entire problem trees',              zh: '完整掌握 3 棵问题树' } },

  // ── True understanding (own-words transfer — the Differentiator law) ──
  { id: 'own_words_5',  tier: 'silver', icon: '🗣️', metric: 'ownWordsCorrect', target: 5,
    name: { en: 'In Your Own Words',  zh: '自陈真知' },
    desc: { en: 'Explained 5 concepts correctly in your own words',   zh: '用自己的话正确解释 5 个概念' } },
  { id: 'own_words_25', tier: 'gold',   icon: '🎙️', metric: 'ownWordsCorrect', target: 25,
    name: { en: 'Voice of Understanding', zh: '理解之声' },
    desc: { en: 'Explained 25 concepts correctly in your own words',  zh: '用自己的话正确解释 25 个概念' } },

  // ── Calibration (knowing what you know) ──
  { id: 'calib_10', tier: 'silver', icon: '🧭', metric: 'confidentCorrect', target: 10,
    name: { en: 'Well-Calibrated', zh: '自知之明' },
    desc: { en: '10 checkpoint answers both confident and correct',   zh: '10 次自信且正确的检查题回答' } },
  { id: 'calib_50', tier: 'gold',   icon: '🎯', metric: 'confidentCorrect', target: 50,
    name: { en: 'True Compass',    zh: '真知罗盘' },
    desc: { en: '50 checkpoint answers both confident and correct',   zh: '50 次自信且正确的检查题回答' } },

  // ── Retention (coming back to re-prove mastery) ──
  { id: 'review_5',  tier: 'silver', icon: '🌾', metric: 'reviewedNodes', target: 5,
    name: { en: 'Gardener',            zh: '园丁' },
    desc: { en: 'Revisited and re-proved 5 verified nodes',           zh: '复习并再次验证 5 个节点' } },
  { id: 'review_20', tier: 'gold',   icon: '🏵️', metric: 'reviewedNodes', target: 20,
    name: { en: 'Keeper of the Grove', zh: '林园守护者' },
    desc: { en: 'Revisited and re-proved 20 verified nodes',          zh: '复习并再次验证 20 个节点' } },

  // ── Question-driven growth (the tree grows from THEIR curiosity) ──
  { id: 'grown_3',  tier: 'bronze',    icon: '🌿', metric: 'selfGrownNodes', target: 3,
    name: { en: 'Curious Mind',            zh: '好奇心' },
    desc: { en: 'Grew 3 tree nodes from your own questions',          zh: '由你自己的提问长出 3 个节点' } },
  { id: 'grown_10', tier: 'silver',    icon: '🌳', metric: 'selfGrownNodes', target: 10,
    name: { en: 'Question Gardener',       zh: '提问园丁' },
    desc: { en: 'Grew 10 tree nodes from your own questions',         zh: '由你自己的提问长出 10 个节点' } },
  { id: 'grown_25', tier: 'legendary', icon: '🌲', metric: 'selfGrownNodes', target: 25,
    name: { en: 'Architect of Curiosity',  zh: '好奇心建筑师' },
    desc: { en: 'Grew 25 tree nodes from your own questions',         zh: '由你自己的提问长出 25 个节点' } },

  // ── Self-knowledge & evidence ──
  { id: 'insight_10', tier: 'silver', icon: '🔭', metric: 'insightCount', target: 10,
    name: { en: 'Self-Knowledge',     zh: '自我认知' },
    desc: { en: "Bob's constellation holds 10 insights about how you learn", zh: 'Bob 的星图已积累 10 条关于你的学习洞察' } },
  { id: 'evidence_5', tier: 'bronze', icon: '📎', metric: 'filesAttached', target: 5,
    name: { en: 'Evidence Collector', zh: '证据收集者' },
    desc: { en: 'Attached 5 files as real learning evidence',         zh: '上传 5 份真实学习证据文件' } },

  // ── Dedication (lifetime XP) ──
  { id: 'xp_1000',  tier: 'bronze', icon: '⚡', metric: 'xp', target: 1000,
    name: { en: 'Rising Star',       zh: '新星' },
    desc: { en: 'Earned 1,000 XP of verified learning', zh: '累计获得 1,000 学习经验值' } },
  { id: 'xp_5000',  tier: 'silver', icon: '⚡', metric: 'xp', target: 5000,
    name: { en: 'Powerhouse',        zh: '强者' },
    desc: { en: 'Earned 5,000 XP of verified learning', zh: '累计获得 5,000 学习经验值' } },
  { id: 'xp_20000', tier: 'legendary', icon: '🌟', metric: 'xp', target: 20000,
    name: { en: 'Luminary',          zh: '星辰' },
    desc: { en: 'Earned 20,000 XP of verified learning', zh: '累计获得 20,000 学习经验值' } },
]

export function getBadge(id: string): BadgeDef | undefined {
  return BADGES.find(b => b.id === id)
}

/**
 * Mastery badges are VERIFIED-only (never self-declared): a tree counts as
 * mastered when every non-pending branch node passed its checkpoints — the
 * "Mark as complete" consolidation alone earns no mastery badge. The root
 * (the problem statement itself) is not a masterable node and is excluded.
 */
async function countMasteredTrees(userId: string): Promise<number> {
  try {
    const completed = await prisma.problemTree.findMany({
      where: { userId, status: 'completed' },
      select: { nodes: { where: { pending: false, parentId: { not: null } }, select: { status: true } } },
    })
    return completed.filter(t => t.nodes.length > 0 && t.nodes.every(n => n.status === 'understood')).length
  } catch {
    return 0
  }
}

/** One pass over the user's branch-node quiz states: own-words correct,
 *  confident-correct, and reviewed-node tallies (all durable counters). */
async function quizStateTallies(userId: string): Promise<{ ownWordsCorrect: number; confidentCorrect: number; reviewedNodes: number }> {
  try {
    const rows = await prisma.treeNode.findMany({
      where: { tree: { userId }, pending: false, parentId: { not: null }, quizState: { not: null } },
      select: { quizState: true },
      take: 2000,
    })
    let ownWordsCorrect = 0, confidentCorrect = 0, reviewedNodes = 0
    for (const r of rows) {
      const qs = parseQuizState(r.quizState)
      ownWordsCorrect += qs.shortCorrect
      confidentCorrect += qs.sureRight
      if (qs.reviewedAt) reviewedNodes += 1
    }
    return { ownWordsCorrect, confidentCorrect, reviewedNodes }
  } catch {
    return { ownWordsCorrect: 0, confidentCorrect: 0, reviewedNodes: 0 }
  }
}

/** Gather the durable stats every badge criterion reads from. */
export async function getBadgeStats(userId: string): Promise<BadgeStats> {
  const [profile, chaptersCompleted, tracksCompleted, projectsCompleted, nodesVerified, treesCompleted, tallies, selfGrownNodes, insightCount, filesAttached] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { userId },
      select: { xp: true, streak: true, longestStreak: true },
    }).catch(() => null),
    prisma.chapter.count({ where: { track: { userId }, status: 'completed' } }).catch(() => 0),
    prisma.track.count({ where: { userId, trackStatus: 'completed' } }).catch(() => 0),
    prisma.subjectProject.count({ where: { track: { userId }, status: 'completed' } }).catch(() => 0),
    // parentId filter: the root auto-flips to 'understood' when a tree
    // completes, but it is not a masterable node — exclude it so verified-node
    // badges count only genuinely checkpoint-verified branches.
    prisma.treeNode.count({ where: { tree: { userId }, pending: false, parentId: { not: null }, status: 'understood' } }).catch(() => 0),
    countMasteredTrees(userId),
    quizStateTallies(userId),
    // Non-seed = born from the student's own questions/asks/hands (schema-lag
    // safe: origin is null on pre-column nodes, which simply don't count).
    prisma.treeNode.count({ where: { tree: { userId }, pending: false, origin: { in: ['copilot', 'question', 'manual'] } } }).catch(() => 0),
    prisma.insight.count({ where: { userId, status: 'active' } }).catch(() => 0),
    prisma.linkedFile.count({ where: { userId, workType: { in: ['tree', 'tree-node'] } } }).catch(() => 0),
  ])
  return {
    // Schema-lag safe: before longestStreak is pushed, fall back to streak.
    longestStreak: Math.max(profile?.longestStreak ?? 0, profile?.streak ?? 0),
    chaptersCompleted,
    tracksCompleted,
    projectsCompleted,
    xp: profile?.xp ?? 0,
    nodesVerified,
    treesCompleted,
    ...tallies,
    selfGrownNodes,
    insightCount,
    filesAttached,
  }
}

/**
 * Lazy evaluator: award any badge whose threshold the student has crossed
 * but doesn't hold yet. Returns the newly earned definitions so callers can
 * celebrate them (unlock overlay + chime on the client).
 */
export async function evaluateAndAwardBadges(userId: string): Promise<BadgeDef[]> {
  try {
    const [stats, earned] = await Promise.all([
      getBadgeStats(userId),
      prisma.userBadge.findMany({ where: { userId }, select: { badgeId: true } }),
    ])
    const earnedIds = new Set(earned.map(b => b.badgeId))
    const newly = BADGES.filter(b => !earnedIds.has(b.id) && stats[b.metric] >= b.target)
    for (const b of newly) {
      try {
        await prisma.userBadge.create({ data: { userId, badgeId: b.id } })
      } catch { /* unique race — someone else awarded it first */ }
    }
    return newly
  } catch {
    // Schema lag (UserBadge not pushed yet) — behave as "nothing new".
    return []
  }
}
