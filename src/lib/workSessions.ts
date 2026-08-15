export const COMPLETED_SESSIONS_STORAGE_KEY = 'eyeguard-completed-work-sessions'

export type CompletedWorkSession = {
  id: string
  completedAt: string
  goal: string
  mode: 'free' | 'pomodoro' | 'smart-pomodoro'
  plannedDurationMinutes: number
  breakDurationMinutes: number
  totalDurationMs: number
  activeDurationMs: number
  awayDurationMs: number
  manualPauseDurationMs: number
}

export function saveCompletedWorkSession(session: CompletedWorkSession) {
  try {
    const current = JSON.parse(
      window.localStorage.getItem(COMPLETED_SESSIONS_STORAGE_KEY) ?? '[]',
    ) as CompletedWorkSession[]
    window.localStorage.setItem(
      COMPLETED_SESSIONS_STORAGE_KEY,
      JSON.stringify([session, ...current].slice(0, 50)),
    )
  } catch {
    // Storage can be unavailable in private browser modes; monitoring still works.
  }
}
