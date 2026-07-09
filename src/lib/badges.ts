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

/** Gather the durable stats every badge criterion reads from. */
export async function getBadgeStats(userId: string): Promise<BadgeStats> {
  const [profile, chaptersCompleted, tracksCompleted, projectsCompleted, nodesVerified, treesCompleted] = await Promise.all([
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
