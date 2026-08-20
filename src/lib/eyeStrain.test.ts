import { describe, expect, it } from 'vitest'
import { buildFatigueMetrics, type BlinkEvent } from './eyeMetrics'
import { buildEyeStrainAssessment } from './eyeStrain'

function metricsFor(blinkEvents: BlinkEvent[], sessionDurationMs = 60_000) {
  return buildFatigueMetrics({
    blinkEvents,
    sessionDurationMs,
    totalClosedEyeMs: 0,
    nowMs: sessionDurationMs,
  })
}

describe('оценка риска зрительного напряжения', () => {
  it('не делает вывод до минимального окна наблюдения', () => {
    const metrics = metricsFor([
      { timestampMs: 5_000, durationMs: 120, closureDepth: 0.9 },
      { timestampMs: 15_000, durationMs: 120, closureDepth: 0.9 },
    ], 30_000)

    const result = buildEyeStrainAssessment({
      metrics,
      sessionDurationMs: 15 * 60_000,
      continuousFocusMs: 30_000,
    })

    expect(result.level).toBe('collecting')
    expect(metrics.estimatedBlinkRatePerMinute).toBe(4)
  })

  it('замечает устойчиво редкое моргание после минуты наблюдения', () => {
    const metrics = metricsFor([
      { timestampMs: 10_000, durationMs: 120, closureDepth: 0.9 },
      { timestampMs: 25_000, durationMs: 120, closureDepth: 0.9 },
      { timestampMs: 40_000, durationMs: 120, closureDepth: 0.9 },
      { timestampMs: 55_000, durationMs: 120, closureDepth: 0.9 },
    ])

    const result = buildEyeStrainAssessment({
      metrics,
      sessionDurationMs: 15 * 60_000,
      continuousFocusMs: 60_000,
    })

    expect(result.level).toBe('moderate')
    expect(result.factors).toContain('low-blink-rate')
    expect(result.recommendations.some((item) => item.includes('полных морганий'))).toBe(true)
  })

  it('объединяет неполные моргания и непрерывную работу в высокий риск', () => {
    const blinkEvents = Array.from({ length: 12 }, (_, index) => ({
      timestampMs: 3_000 + index * 4_500,
      durationMs: 120,
      closureDepth: index < 8 ? 0.35 : 0.9,
    }))
    const metrics = metricsFor(blinkEvents)

    const result = buildEyeStrainAssessment({
      metrics,
      sessionDurationMs: 21 * 60_000,
      continuousFocusMs: 21 * 60_000,
      baselineBlinkRate: 12,
    })

    expect(metrics.incompleteBlinkRatio).toBeCloseTo(8 / 12)
    expect(result.level).toBe('high')
    expect(result.factors).toContain('incomplete-blinks')
    expect(result.factors).toContain('continuous-screen-time')
  })

  it('учитывает отмеченные пользователем симптомы', () => {
    const blinkEvents = Array.from({ length: 12 }, (_, index) => ({
      timestampMs: 2_000 + index * 4_500,
      durationMs: 120,
      closureDepth: 0.9,
    }))
    const metrics = metricsFor(blinkEvents)

    const result = buildEyeStrainAssessment({
      metrics,
      sessionDurationMs: 15 * 60_000,
      continuousFocusMs: 60_000,
      reportedSymptoms: ['dryness', 'blur'],
    })

    expect(result.level).toBe('moderate')
    expect(result.factors).toContain('reported-symptoms')
  })

  it('не выдаёт предупреждение в первые 15 минут сессии', () => {
    const metrics = metricsFor([
      { timestampMs: 15_000, durationMs: 120, closureDepth: 0.3 },
      { timestampMs: 30_000, durationMs: 120, closureDepth: 0.3 },
      { timestampMs: 45_000, durationMs: 120, closureDepth: 0.3 },
    ])

    const result = buildEyeStrainAssessment({
      metrics,
      sessionDurationMs: 14 * 60_000 + 59_000,
      continuousFocusMs: 14 * 60_000 + 59_000,
      reportedSymptoms: ['dryness', 'blur', 'headache'],
    })

    expect(result.score).toBeGreaterThanOrEqual(50)
    expect(result.level).toBe('collecting')
    expect(result.alertsSuppressed).toBe(true)
    expect(result.suppressionRemainingMs).toBe(1_000)
  })

  it('включает оценку риска ровно через 15 минут', () => {
    const metrics = metricsFor([
      { timestampMs: 15_000, durationMs: 120, closureDepth: 0.3 },
      { timestampMs: 30_000, durationMs: 120, closureDepth: 0.3 },
      { timestampMs: 45_000, durationMs: 120, closureDepth: 0.3 },
    ])

    const result = buildEyeStrainAssessment({
      metrics,
      sessionDurationMs: 15 * 60_000,
      continuousFocusMs: 15 * 60_000,
      reportedSymptoms: ['dryness', 'blur', 'headache'],
    })

    expect(result.level).toBe('high')
    expect(result.alertsSuppressed).toBe(false)
  })
})
