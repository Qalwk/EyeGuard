import { describe, expect, it } from 'vitest'
import { formatTaskDuration, taskProgress } from './workTasks'

describe('taskProgress', () => {
  it('keeps the main bar capped while preserving progress above 100%', () => {
    expect(taskProgress(132 * 60_000, 120)).toEqual({
      percent: 110,
      mainWidth: 100,
      overflowWidth: 10,
      overtimeMs: 12 * 60_000,
    })
  })

  it('formats task time for cards and calendar summaries', () => {
    expect(formatTaskDuration(80 * 60_000)).toBe('1 ч 20 мин')
  })
})
