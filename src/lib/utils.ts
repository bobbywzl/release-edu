import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function calculateOverallProgress(nodes: { status: string }[]): number {
  const completed = nodes.filter((n) => n.status === "completed").length;
  return Math.round((completed / nodes.length) * 100);
}

export function getLevelFromXP(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function getXPToNextLevel(xp: number): { current: number; needed: number } {
  const level = getLevelFromXP(xp);
  const currentLevelXP = Math.pow(level - 1, 2) * 100;
  const nextLevelXP = Math.pow(level, 2) * 100;
  return {
    current: xp - currentLevelXP,
    needed: nextLevelXP - currentLevelXP,
  };
}

export const STAGE_LABELS = {
  motivation: "Motivation & Inspiration",
  review: "Review & Adjustment",
  "self-guided": "Self-Guided Learning",
  "expert-feedback": "Expert Feedback",
} as const;

export const STAGE_DESCRIPTIONS = {
  motivation: "Exploring what excites you and why you want to learn",
  review: "Reflecting on progress and adjusting your learning path",
  "self-guided": "Independently driving your learning with AI support",
  "expert-feedback": "Getting feedback from domain experts and mentors",
} as const;
