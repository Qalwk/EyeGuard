export type AttentionStatus = 'active' | 'away' | 'uncertain' | 'paused'
export type Sensitivity = 'soft' | 'normal' | 'strict'

export type HeadAngles = { yaw: number; pitch: number; roll: number }
export type CalibrationProfile = { angles: HeadAngles; savedAt: number }

export const CALIBRATION_STORAGE_KEY = 'eyeguard-presence-calibration'
export const SENSITIVITY_STORAGE_KEY = 'eyeguard-presence-sensitivity'

const limits: Record<Sensitivity, { angle: number; awayAfterMs: number }> = {
  soft: { angle: 30, awayAfterMs: 1000 },
  normal: { angle: 22, awayAfterMs: 1000 },
  strict: { angle: 16, awayAfterMs: 700 },
}

export function loadCalibration(): CalibrationProfile | null {
  try {
    const stored = window.localStorage.getItem(CALIBRATION_STORAGE_KEY)
    if (!stored) return null
    const value = JSON.parse(stored) as CalibrationProfile
    return Number.isFinite(value?.angles?.yaw) && Number.isFinite(value?.angles?.pitch) && Number.isFinite(value?.angles?.roll)
      ? value
      : null
  } catch {
    return null
  }
}

export function loadSensitivity(): Sensitivity {
  const value = window.localStorage.getItem(SENSITIVITY_STORAGE_KEY)
  return value === 'soft' || value === 'strict' ? value : 'normal'
}

export function anglesFromTransformationMatrix(data: number[] | undefined): HeadAngles | null {
  if (!data || data.length < 16) return null
  // MediaPipe returns a 4×4 row-major pose matrix. We only retain its rotation.
  const r00 = data[0]
  const r10 = data[4]
  const r20 = data[8]
  const r21 = data[9]
  const r22 = data[10]
  if (![r00, r10, r20, r21, r22].every(Number.isFinite)) return null
  const radians = 180 / Math.PI
  return {
    yaw: Math.atan2(r10, r00) * radians,
    pitch: Math.atan2(-r20, Math.hypot(r21, r22)) * radians,
    roll: Math.atan2(r21, r22) * radians,
  }
}

export function smoothAngles(previous: HeadAngles | null, next: HeadAngles, factor = 0.18): HeadAngles {
  if (!previous) return next
  return {
    yaw: previous.yaw + (next.yaw - previous.yaw) * factor,
    pitch: previous.pitch + (next.pitch - previous.pitch) * factor,
    roll: previous.roll + (next.roll - previous.roll) * factor,
  }
}

export function isLookingAway(angles: HeadAngles, baseline: HeadAngles, sensitivity: Sensitivity) {
  const limit = limits[sensitivity].angle
  // Depending on a camera's orientation, MediaPipe can encode a nod in either
  // pitch or roll. Treat both as vertical movement; the slightly smaller limit
  // makes looking down/up react as readily as turning away.
  const verticalLimit = limit * 0.8
  return (
    Math.abs(angles.yaw - baseline.yaw) > limit ||
    Math.abs(angles.pitch - baseline.pitch) > verticalLimit ||
    Math.abs(angles.roll - baseline.roll) > verticalLimit
  )
}

export function awayDelayMs(sensitivity: Sensitivity) {
  return limits[sensitivity].awayAfterMs
}
