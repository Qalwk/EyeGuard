export const THRESHOLD_MIN = 10
export const THRESHOLD_MAX = 100

export function validateThresholdInput(rawValue: string) {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { value: null, error: 'Укажите порог сигнала для перерыва.' }
  }

  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: 'Порог должен быть целым числом без пробелов и символов.' }
  }

  const parsedValue = Number(trimmed)

  if (parsedValue < THRESHOLD_MIN) {
    return { value: null, error: `Минимально допустимое значение - ${THRESHOLD_MIN}.` }
  }

  if (parsedValue > THRESHOLD_MAX) {
    return { value: null, error: `Максимально допустимое значение - ${THRESHOLD_MAX}.` }
  }

  return { value: parsedValue, error: '' }
}

export function clampThreshold(value: number) {
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value))
}
