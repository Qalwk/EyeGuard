import { describe, expect, it } from 'vitest'
import { appendTimelineSegment, buildCompletedWorkSession, replaceTimelineTail } from './sessionSummary'
import type { SessionSummaryInput, } from './sessionSummary'
import type { TimelineSegment } from './workSessions'

function input(overrides: Partial<SessionSummaryInput> = {}): SessionSummaryInput {
  return {
    id: 'session-1',
    ownerId: 'user:1',
    startedAt: '2026-08-19T10:00:00.000Z',
    completedAt: '2026-08-19T10:30:00.000Z',
    goal: '',
    mode: 'free',
    plannedDurationMinutes: 0,
    breakDurationMinutes: 0,
    totalDurationMs: 1_800_000,
    timeline: [{ type: 'active', startOffsetMs: 0, endOffsetMs: 1_800_000 }],
    fatigueScoreIntegral: 0,
    eyeTrackedDurationMs: 1_800_000,
    eyeWarningDurationMs: 0,
    ...overrides,
  }
}

describe('итог сессии', () => {
  it('даёт 100 баллов за полностью активную ровную сессию', () => {
    const session = buildCompletedWorkSession(input())
    expect(session.score).toMatchObject({ total: 100, presencePoints: 50, stabilityPoints: 30, eyePoints: 20 })
    expect(session.summaryLabel).toBe('Ровная сессия')
  })

  it('не штрафует ручную паузу и Pomodoro-перерыв', () => {
    const session = buildCompletedWorkSession(input({
      totalDurationMs: 3_000_000,
      timeline: [
        { type: 'active', startOffsetMs: 0, endOffsetMs: 1_800_000 },
        { type: 'manual-pause', startOffsetMs: 1_800_000, endOffsetMs: 2_100_000, reason: 'user-paused' },
        { type: 'pomodoro-break', startOffsetMs: 2_100_000, endOffsetMs: 3_000_000, reason: 'scheduled-break' },
      ],
    }))
    expect(session.score.total).toBe(100)
    expect(session.manualPauseDurationMs).toBe(300_000)
    expect(session.pomodoroBreakDurationMs).toBe(900_000)
  })

  it('нормализует итог по 80 баллам, когда данных о глазах недостаточно', () => {
    const session = buildCompletedWorkSession(input({ eyeTrackedDurationMs: 30_000 }))
    expect(session.score.eyePoints).toBeNull()
    expect(session.score.total).toBe(100)
    expect(session.eyeState).toBe('insufficient-data')
  })

  it('не показывает ложный ноль без измеряемого рабочего времени', () => {
    const session = buildCompletedWorkSession(input({
      timeline: [{ type: 'untracked', startOffsetMs: 0, endOffsetMs: 1_800_000, reason: 'camera-uncertain' }],
      eyeTrackedDurationMs: 0,
    }))
    expect(session.score.total).toBeNull()
    expect(session.score.presencePoints).toBeNull()
  })

  it('учитывает долю присутствия, частоту уходов и усталость с весами 50/30/20', () => {
    const timeline: TimelineSegment[] = [
      { type: 'active', startOffsetMs: 0, endOffsetMs: 900_000 },
      { type: 'away', startOffsetMs: 900_000, endOffsetMs: 1_800_000, reason: 'face-missing' },
    ]
    const session = buildCompletedWorkSession(input({
      timeline,
      fatigueScoreIntegral: 50 * 900_000,
      eyeTrackedDurationMs: 900_000,
      eyeWarningDurationMs: 300_000,
    }))
    expect(session.score.presencePoints).toBe(25)
    expect(session.score.stabilityPoints).toBe(26.3)
    expect(session.score.eyePoints).toBe(10)
    expect(session.score.total).toBe(61)
    expect(session.summaryLabel).toBe('Стоит отдохнуть')
  })
})

describe('таймлайн', () => {
  it('объединяет соседние одинаковые интервалы', () => {
    const timeline: TimelineSegment[] = []
    appendTimelineSegment(timeline, 'active', 0, 1000)
    appendTimelineSegment(timeline, 'active', 1000, 2000)
    expect(timeline).toEqual([{ type: 'active', startOffsetMs: 0, endOffsetMs: 2000 }])
  })

  it('заменяет неопределённый хвост на уход после порога отсутствия лица', () => {
    const timeline: TimelineSegment[] = [
      { type: 'active', startOffsetMs: 0, endOffsetMs: 10_000 },
      { type: 'untracked', startOffsetMs: 10_000, endOffsetMs: 15_000, reason: 'camera-uncertain' },
    ]
    replaceTimelineTail(timeline, 10_000, 'away', 15_000, 'face-missing')
    expect(timeline).toEqual([
      { type: 'active', startOffsetMs: 0, endOffsetMs: 10_000 },
      { type: 'away', startOffsetMs: 10_000, endOffsetMs: 15_000, reason: 'face-missing' },
    ])
  })
})
