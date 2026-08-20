import { describe, expect, it } from 'vitest'
import { mergeWorkSessionHistories, migrateLegacySession, sessionsBeyondRetention, type CompletedWorkSession } from './workSessions'

describe('миграция истории сессий', () => {
  it('переносит старую запись в отдельную legacy-группу без потери длительностей', () => {
    const migrated = migrateLegacySession({
      id: 'old-1',
      completedAt: '2026-08-19T10:30:00.000Z',
      totalDurationMs: 1_800_000,
      activeDurationMs: 1_200_000,
      awayDurationMs: 300_000,
      manualPauseDurationMs: 120_000,
    })
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      ownerId: 'legacy',
      activeDurationMs: 1_200_000,
      awayDurationMs: 300_000,
      legacy: true,
    })
    expect(migrated.untrackedDurationMs).toBe(180_000)
    expect(migrated.score.total).toBeNull()
  })

  it('оставляет 1000 самых новых сессий на владельца', () => {
    const sessions = Array.from({ length: 1002 }, (_, index) => ({
      id: String(index),
      completedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })) as CompletedWorkSession[]
    const stale = sessionsBeyondRetention(sessions)
    expect(stale).toHaveLength(2)
    expect(stale.map((session) => session.id)).toEqual(['1', '0'])
  })

  it('объединяет личные и старые сессии для календаря по дате', () => {
    const personal = [{ id: 'personal', completedAt: '2026-08-19T10:00:00.000Z' }] as CompletedWorkSession[]
    const legacy = [{ id: 'legacy', completedAt: '2026-08-16T11:58:00.000Z', ownerId: 'legacy' }] as CompletedWorkSession[]

    expect(mergeWorkSessionHistories(personal, legacy).map((session) => session.id)).toEqual(['personal', 'legacy'])
  })
})
