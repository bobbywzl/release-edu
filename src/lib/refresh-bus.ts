'use client'

/**
 * Client-side refresh bus.
 * Call `triggerCurriculumRefresh()` after any API call that mutates curriculum/chapter data.
 * All hooks (useStudentData, useCurriculumOverview, useCompletionStats) listen for this event
 * and re-fetch immediately instead of waiting for their polling interval.
 */
export function triggerCurriculumRefresh() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('curriculum-updated'))
}
