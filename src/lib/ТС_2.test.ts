import { describe, expect, it } from 'vitest'
import { APP_LABELS } from './appLabels'
import { buildFatigueMetrics, formatSessionDuration } from './eyeMetrics'

describe('ТС_2 — фиксация морганий и расчёт показателей', () => {
  it('учитывает только моргания за последнюю минуту', () => {
    const nowMs = 120_000
    const blinkEvents = [
      { timestampMs: 10_000, durationMs: 100 },
      { timestampMs: 70_000, durationMs: 110 },
      { timestampMs: 80_000, durationMs: 120 },
      { timestampMs: 90_000, durationMs: 130 },
    ]

    const metrics = buildFatigueMetrics({
      blinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 460,
      nowMs,
    })

    expect(blinkEvents.length).toBe(4)
    expect(metrics.blinkRatePerMinute).toBe(3)
    expect(metrics.averageBlinkDurationMs).toBeCloseTo(120, 0)
  })

  it('до минуты сеанса частота равна количеству морганий в окне', () => {
    const nowMs = 48_000
    const blinkEvents = Array.from({ length: 20 }, (_, index) => ({
      timestampMs: 1_000 + index * 2_000,
      durationMs: 256,
    }))

    const metrics = buildFatigueMetrics({
      blinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 6_400,
      nowMs,
    })

    expect(metrics.blinkRatePerMinute).toBe(20)
  })

  it('использует названия карточек показателей мониторинга', () => {
    expect(APP_LABELS.blinkCountTitle).toBe('Количество морганий')
    expect(APP_LABELS.blinkRateTitle).toBe('Частота морганий')
    expect(APP_LABELS.averageBlinkDurationTitle).toBe('Средняя длительность моргания')
    expect(APP_LABELS.fatigueLevelTitle).toBe('Текущий уровень утомления')
  })

  it('форматирует длительность сеанса в формате ЧЧ:ММ:СС', () => {
    expect(formatSessionDuration(3_661_000)).toBe('01:01:01')
    expect(formatSessionDuration(45_000)).toBe('00:00:45')
  })

  it('при частоте ниже 10/мин уровень утомления равен 0', () => {
    const nowMs = 48_000
    const blinkEvents = Array.from({ length: 8 }, (_, index) => ({
      timestampMs: 2_000 + index * 5_000,
      durationMs: 398,
    }))

    const metrics = buildFatigueMetrics({
      blinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 20_000,
      nowMs,
    })

    expect(metrics.blinkRatePerMinute).toBe(8)
    expect(metrics.fatigueScore).toBe(0)
  })
})
