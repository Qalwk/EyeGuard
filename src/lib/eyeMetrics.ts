type LandmarkPoint = {
  x: number
  y: number
}

export type BlinkEvent = {
  timestampMs: number
  durationMs: number
}

export type FatigueMetrics = {
  blinkRatePerMinute: number
  averageBlinkDurationMs: number
  eyeClosureRatio: number
  fatigueScore: number
}

const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144] as const
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380] as const
const MILLIS_IN_MINUTE = 60_000

function distance(first: LandmarkPoint, second: LandmarkPoint) {
  const deltaX = first.x - second.x
  const deltaY = first.y - second.y

  return Math.hypot(deltaX, deltaY)
}

function calculateEyeAspectRatio(landmarks: LandmarkPoint[], indices: readonly number[]) {
  const [leftCorner, upperFirst, upperSecond, rightCorner, lowerSecond, lowerFirst] = indices
  const horizontalDistance = distance(landmarks[leftCorner], landmarks[rightCorner])

  if (horizontalDistance === 0) {
    return 0
  }

  const verticalDistance =
    distance(landmarks[upperFirst], landmarks[lowerFirst]) +
    distance(landmarks[upperSecond], landmarks[lowerSecond])

  return verticalDistance / (2 * horizontalDistance)
}

export function calculateAverageEar(landmarks: LandmarkPoint[]) {
  const leftEar = calculateEyeAspectRatio(landmarks, LEFT_EYE_INDICES)
  const rightEar = calculateEyeAspectRatio(landmarks, RIGHT_EYE_INDICES)

  return (leftEar + rightEar) / 2
}

const NORMAL_BLINK_RATE_PER_MINUTE = 10
export const HIGH_BLINK_RATE_WARNING = 15
const TC3_BLINK_RATE_PER_MINUTE = HIGH_BLINK_RATE_WARNING
const TC3_FATIGUE_SCORE = 12
const FATIGUE_POINTS_PER_BLINK_ABOVE_NORMAL =
  TC3_FATIGUE_SCORE / (TC3_BLINK_RATE_PER_MINUTE - NORMAL_BLINK_RATE_PER_MINUTE)
const FATIGUE_POINTS_PER_BLINK_ABOVE_TC3 = 5

export function calculateFatigueScore(blinkRatePerMinute: number) {
  if (blinkRatePerMinute <= NORMAL_BLINK_RATE_PER_MINUTE) {
    return 0
  }

  if (blinkRatePerMinute <= TC3_BLINK_RATE_PER_MINUTE) {
    return Math.round(
      (blinkRatePerMinute - NORMAL_BLINK_RATE_PER_MINUTE) * FATIGUE_POINTS_PER_BLINK_ABOVE_NORMAL,
    )
  }

  const acceleratedScore =
    TC3_FATIGUE_SCORE +
    (blinkRatePerMinute - TC3_BLINK_RATE_PER_MINUTE) * FATIGUE_POINTS_PER_BLINK_ABOVE_TC3

  return Math.min(100, Math.round(acceleratedScore))
}

export function buildFatigueMetrics(params: {
  blinkEvents: BlinkEvent[]
  sessionDurationMs: number
  totalClosedEyeMs: number
  nowMs: number
}): FatigueMetrics {
  const { blinkEvents, sessionDurationMs, nowMs } = params
  const windowStartMs = nowMs - MILLIS_IN_MINUTE
  const recentBlinks = blinkEvents.filter((blink) => blink.timestampMs >= windowStartMs)
  const blinkRatePerMinute = recentBlinks.length

  const totalBlinkDurationMs = recentBlinks.reduce((sum, blink) => sum + blink.durationMs, 0)
  const averageBlinkDurationMs =
    recentBlinks.length > 0 ? totalBlinkDurationMs / recentBlinks.length : 0

  const measurementWindowMs = Math.min(Math.max(sessionDurationMs, 1), MILLIS_IN_MINUTE)
  const eyeClosureRatio =
    measurementWindowMs > 0 ? totalBlinkDurationMs / measurementWindowMs : 0

  const fatigueScore = calculateFatigueScore(blinkRatePerMinute)

  return {
    blinkRatePerMinute,
    averageBlinkDurationMs,
    eyeClosureRatio,
    fatigueScore,
  }
}

export function formatSessionDuration(sessionDurationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(sessionDurationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}
