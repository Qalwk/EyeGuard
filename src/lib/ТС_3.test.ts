import { describe, expect, it } from 'vitest'
import {
  formatFatigueLevel,
  getStatusBadgeText,
  getUserStateText,
  resolveMonitoringStatus,
} from './appLabels'
import { buildFatigueMetrics, calculateFatigueScore } from './eyeMetrics'

describe('ТС_3 — предупреждение о превышении порога утомления', () => {
  const tc3BlinkEvents = Array.from({ length: 15 }, (_, index) => ({
    timestampMs: 2_000 + index * 3_000,
    durationMs: 120,
  }))

  it('при 15 морганиях за 50 с даёт уровень утомления 12 / 100', () => {
    const nowMs = 50_000

    const metrics = buildFatigueMetrics({
      blinkEvents: tc3BlinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 0,
      nowMs,
    })

    expect(metrics.blinkRatePerMinute).toBe(15)
    expect(metrics.fatigueScore).toBe(12)
    expect(formatFatigueLevel(metrics.fatigueScore)).toBe('12 / 100')
  })

  it('при пороге 10 и 15 морганиях/мин включает предупреждение', () => {
    const nowMs = 50_000
    const threshold = 10

    const metrics = buildFatigueMetrics({
      blinkEvents: tc3BlinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 0,
      nowMs,
    })

    expect(
      resolveMonitoringStatus(metrics.fatigueScore, threshold, metrics.blinkRatePerMinute),
    ).toBe('warning')
    expect(getStatusBadgeText('warning')).toBe('Обнаружены признаки утомления')
    expect(getUserStateText('warning')).toBe(
      'Показатель утомления превысил заданный порог. Рекомендуется сделать перерыв.',
    )
  })

  it('при 15 морганиях/мин и пороге 25 сразу включает предупреждение', () => {
    const nowMs = 50_000

    const metrics = buildFatigueMetrics({
      blinkEvents: tc3BlinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 0,
      nowMs,
    })

    expect(metrics.blinkRatePerMinute).toBe(15)
    expect(resolveMonitoringStatus(metrics.fatigueScore, 25, metrics.blinkRatePerMinute)).toBe(
      'warning',
    )
  })

  it('при частоте ниже 15/мин предупреждение не включается', () => {
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
    expect(resolveMonitoringStatus(metrics.fatigueScore, 25, metrics.blinkRatePerMinute)).toBe(
      'tracking',
    )
  })

  it('при пороге 10 и уровне 9 остаётся в состоянии отслеживания', () => {
    expect(resolveMonitoringStatus(9, 10, 8)).toBe('tracking')
    expect(getUserStateText('tracking')).toBe(
      'Показатель утомления находится в допустимых пределах.',
    )
  })

  it('срабатывает при равенстве уровня и порога (≥ 10)', () => {
    expect(resolveMonitoringStatus(10, 10, 12)).toBe('warning')
  })

  it('при 18 морганиях/мин показатель превышает порог 25', () => {
    expect(calculateFatigueScore(18)).toBe(27)

    const nowMs = 48_000
    const blinkEvents = Array.from({ length: 18 }, (_, index) => ({
      timestampMs: 2_000 + index * 2_500,
      durationMs: 120,
    }))

    const metrics = buildFatigueMetrics({
      blinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 0,
      nowMs,
    })

    expect(metrics.blinkRatePerMinute).toBe(18)
    expect(resolveMonitoringStatus(metrics.fatigueScore, 25, metrics.blinkRatePerMinute)).toBe(
      'warning',
    )
  })

  it('при 15 морганиях за минуту уровень достигает порога 10', () => {
    const nowMs = 60_000
    const blinkEvents = Array.from({ length: 15 }, (_, index) => ({
      timestampMs: 1_000 + index * 3_500,
      durationMs: 120,
    }))

    const metrics = buildFatigueMetrics({
      blinkEvents,
      sessionDurationMs: nowMs,
      totalClosedEyeMs: 1_800,
      nowMs,
    })

    expect(metrics.blinkRatePerMinute).toBe(15)
    expect(metrics.fatigueScore).toBe(12)
  })
})
