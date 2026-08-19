import type { CompletedWorkSession, EyeSummaryState, SessionMode, TimelineSegment, TimelineSegmentType } from './workSessions'

export type SessionSummaryInput = {
  id: string
  ownerId: string
  startedAt: string
  completedAt: string
  goal: string
  mode: SessionMode
  plannedDurationMinutes: number
  breakDurationMinutes: number
  totalDurationMs: number
  timeline: TimelineSegment[]
  fatigueScoreIntegral: number
  eyeTrackedDurationMs: number
  eyeWarningDurationMs: number
}

const durationFor = (timeline: TimelineSegment[], type: TimelineSegmentType) => timeline.filter((segment) => segment.type === type).reduce((total, segment) => total + Math.max(0, segment.endOffsetMs - segment.startOffsetMs), 0)
const roundPoint = (value: number) => Math.round(Math.max(0, value) * 10) / 10

export function appendTimelineSegment(timeline: TimelineSegment[], type: TimelineSegmentType, startOffsetMs: number, endOffsetMs: number, reason?: TimelineSegment['reason']) {
  if (endOffsetMs <= startOffsetMs) return timeline
  const last = timeline[timeline.length - 1]
  if (last && last.type === type && last.reason === reason && startOffsetMs - last.endOffsetMs <= 1000) {
    last.endOffsetMs = endOffsetMs
    return timeline
  }
  timeline.push({ type, startOffsetMs, endOffsetMs, reason })
  return timeline
}

export function replaceTimelineTail(timeline: TimelineSegment[], fromOffsetMs: number, type: TimelineSegmentType, endOffsetMs: number, reason?: TimelineSegment['reason']) {
  while (timeline.length > 0 && timeline[timeline.length - 1].startOffsetMs >= fromOffsetMs) timeline.pop()
  const last = timeline[timeline.length - 1]
  if (last && last.endOffsetMs > fromOffsetMs) last.endOffsetMs = fromOffsetMs
  return appendTimelineSegment(timeline, type, fromOffsetMs, endOffsetMs, reason)
}

export function buildCompletedWorkSession(input: SessionSummaryInput): CompletedWorkSession {
  const activeDurationMs = durationFor(input.timeline, 'active')
  const awayDurationMs = durationFor(input.timeline, 'away')
  const manualPauseDurationMs = durationFor(input.timeline, 'manual-pause')
  const pomodoroBreakDurationMs = durationFor(input.timeline, 'pomodoro-break')
  const untrackedDurationMs = durationFor(input.timeline, 'untracked')
  const measuredWorkMs = activeDurationMs + awayDurationMs
  const activeRatio = measuredWorkMs > 0 ? activeDurationMs / measuredWorkMs : null
  const awayEventCount = input.timeline.filter((segment) => segment.type === 'away').length
  const normalizedAwayEvents = awayEventCount / Math.max(measuredWorkMs / 1_800_000, 1)
  const averageFatigueScore = input.eyeTrackedDurationMs >= 60_000 ? Math.min(100, input.fatigueScoreIntegral / input.eyeTrackedDurationMs) : null
  const presencePoints = activeRatio === null ? null : roundPoint(activeRatio * 50)
  const stabilityPoints = activeRatio === null ? null : roundPoint(30 * (1 - Math.min(normalizedAwayEvents, 8) / 8))
  const eyePoints = averageFatigueScore === null ? null : roundPoint(20 * (1 - averageFatigueScore / 100))
  let total: number | null = null
  if (presencePoints !== null && stabilityPoints !== null) {
    const earned = presencePoints + stabilityPoints + (eyePoints ?? 0)
    total = Math.round((earned / (eyePoints === null ? 80 : 100)) * 100)
  }

  const warningRatio = input.eyeTrackedDurationMs > 0 ? input.eyeWarningDurationMs / input.eyeTrackedDurationMs : 0
  let eyeState: EyeSummaryState = 'insufficient-data'
  if (averageFatigueScore !== null) eyeState = averageFatigueScore >= 35 || warningRatio >= 0.25 ? 'rest-recommended' : averageFatigueScore >= 12 || warningRatio >= 0.1 ? 'strained' : 'comfortable'

  let summaryLabel = 'Ровная сессия'
  let summaryReason = activeRatio === null ? 'Камере не хватило данных, чтобы оценить рабочее время.' : `${Math.round(activeRatio * 100)}% измеренного рабочего времени вы были у экрана.`
  if (eyeState === 'rest-recommended') {
    summaryLabel = 'Стоит отдохнуть'
    summaryReason = 'Сигналы состояния глаз чаще обычного указывали на напряжение.'
  } else if (normalizedAwayEvents >= 4) {
    summaryLabel = 'Было много переключений'
    summaryReason = `${awayEventCount} ${awayEventCount === 1 ? 'уход' : 'уходов'} от экрана нарушили рабочий ритм.`
  } else if (activeRatio !== null && activeRatio < 0.75) {
    summaryLabel = 'Много времени вне экрана'
    summaryReason = `У экрана прошло ${Math.round(activeRatio * 100)}% измеренного рабочего времени.`
  }

  const losses = [
    { type: 'presence', value: activeRatio === null ? -1 : 1 - activeRatio },
    { type: 'stability', value: activeRatio === null ? -1 : Math.min(normalizedAwayEvents / 8, 1) },
    { type: 'eyes', value: averageFatigueScore === null ? -1 : averageFatigueScore / 100 },
  ].sort((first, second) => second.value - first.value)
  let recommendation = 'Сохраните этот спокойный ритм в следующей сессии.'
  if (losses[0].value > 0.15) {
    recommendation = losses[0].type === 'eyes' ? 'Сделайте перерыв на 5–10 минут и дайте глазам посмотреть вдаль.' : losses[0].type === 'presence' ? 'Перед следующей сессией подготовьте всё нужное, чтобы реже надолго отходить.' : 'На следующую сессию отключите лишние уведомления и соберите задачи в один блок.'
  } else if (activeDurationMs >= 50 * 60_000) {
    recommendation = 'После длинного фокус-блока сделайте короткий перерыв и посмотрите вдаль.'
  }

  return {
    schemaVersion: 2, id: input.id, ownerId: input.ownerId, startedAt: input.startedAt, completedAt: input.completedAt,
    goal: input.goal, mode: input.mode, plannedDurationMinutes: input.plannedDurationMinutes, breakDurationMinutes: input.breakDurationMinutes,
    totalDurationMs: input.totalDurationMs, activeDurationMs, awayDurationMs, manualPauseDurationMs, pomodoroBreakDurationMs, untrackedDurationMs,
    awayEventCount, eyeTrackedDurationMs: input.eyeTrackedDurationMs, eyeWarningDurationMs: input.eyeWarningDurationMs,
    score: { total, presencePoints, stabilityPoints, eyePoints, activeRatio, normalizedAwayEvents, averageFatigueScore, measurementCoverage: measuredWorkMs + untrackedDurationMs > 0 ? measuredWorkMs / (measuredWorkMs + untrackedDurationMs) : 0 },
    eyeState, summaryLabel, summaryReason, recommendation, timeline: input.timeline,
  }
}
