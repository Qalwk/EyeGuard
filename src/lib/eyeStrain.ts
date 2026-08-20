import type { FatigueMetrics } from './eyeMetrics'

export type EyeSymptom = 'dryness' | 'blur' | 'headache' | 'heavy-eyelids'
export type EyeStrainRiskLevel = 'collecting' | 'low' | 'moderate' | 'high'

export type EyeStrainFactor =
  | 'low-blink-rate'
  | 'high-blink-rate'
  | 'incomplete-blinks'
  | 'long-eye-closures'
  | 'continuous-screen-time'
  | 'reported-symptoms'

export type EyeStrainAssessment = {
  score: number
  level: EyeStrainRiskLevel
  title: string
  explanation: string
  factors: EyeStrainFactor[]
  recommendations: string[]
  alertsSuppressed: boolean
  suppressionRemainingMs: number
}

export const EYE_SYMPTOM_LABELS: Record<EyeSymptom, string> = {
  dryness: 'Сухость или жжение',
  blur: 'Затуманивание',
  headache: 'Головная боль',
  'heavy-eyelids': 'Тяжесть век',
}

const MIN_OBSERVATION_MS = 45_000
const SCREEN_BREAK_REMINDER_MS = 20 * 60_000
export const WARNING_SUPPRESSION_MS = 15 * 60_000

export const initialEyeStrainAssessment: EyeStrainAssessment = {
  score: 0,
  level: 'collecting',
  title: 'Собираем личную норму',
  explanation: 'Первые 45 секунд нужны, чтобы оценить естественный ритм моргания.',
  factors: [],
  recommendations: ['Смотрите на экран как обычно — специально моргать не нужно.'],
  alertsSuppressed: false,
  suppressionRemainingMs: 0,
}

function addUnique(items: string[], value: string) {
  if (!items.includes(value)) items.push(value)
}

export function buildEyeStrainAssessment(params: {
  metrics: FatigueMetrics
  sessionDurationMs: number
  continuousFocusMs: number
  baselineBlinkRate?: number | null
  reportedSymptoms?: EyeSymptom[]
}): EyeStrainAssessment {
  const {
    metrics,
    sessionDurationMs,
    continuousFocusMs,
    baselineBlinkRate = null,
    reportedSymptoms = [],
  } = params
  const factors: EyeStrainFactor[] = []
  const recommendations: string[] = []
  let score = 0

  const hasEnoughObservation = metrics.observationDurationMs >= MIN_OBSERVATION_MS
  const blinkRate = metrics.estimatedBlinkRatePerMinute
  const lowBlinkThreshold = baselineBlinkRate && baselineBlinkRate >= 5
    ? Math.max(4, baselineBlinkRate * 0.55)
    : 8
  const highBlinkThreshold = baselineBlinkRate && baselineBlinkRate >= 5
    ? Math.max(25, baselineBlinkRate * 1.8)
    : 25

  if (hasEnoughObservation && blinkRate < lowBlinkThreshold) {
    factors.push('low-blink-rate')
    score += blinkRate < lowBlinkThreshold * 0.65 ? 35 : 25
    addUnique(recommendations, 'Посмотрите вдаль не менее 20 секунд.')
    addUnique(recommendations, 'Сделайте 5–10 спокойных полных морганий.')
  }

  if (hasEnoughObservation && blinkRate > highBlinkThreshold) {
    factors.push('high-blink-rate')
    score += 15
    addUnique(recommendations, 'Проверьте, нет ли бликов, сухого воздуха или потока от вентилятора.')
  }

  if (
    metrics.characterizedBlinkCount >= 4 &&
    metrics.incompleteBlinkRatio >= 0.4
  ) {
    factors.push('incomplete-blinks')
    score += metrics.incompleteBlinkRatio >= 0.65 ? 30 : 20
    addUnique(recommendations, 'Сделайте 5–10 спокойных полных морганий.')
  }

  if (metrics.blinkRatePerMinute >= 4 && metrics.longBlinkRatio >= 0.25) {
    factors.push('long-eye-closures')
    score += 15
    addUnique(recommendations, 'Если хочется закрыть глаза, сделайте полноценный перерыв без экрана.')
  }

  if (continuousFocusMs >= SCREEN_BREAK_REMINDER_MS) {
    factors.push('continuous-screen-time')
    score += continuousFocusMs >= SCREEN_BREAK_REMINDER_MS * 2 ? 35 : 25
    addUnique(recommendations, 'Отведите взгляд от экрана: посмотрите вдаль не менее 20 секунд.')
  }

  if (reportedSymptoms.length > 0) {
    factors.push('reported-symptoms')
    score += Math.min(35, reportedSymptoms.length * 12)
    addUnique(recommendations, 'Если дискомфорт не проходит после отдыха или регулярно возвращается, проверьте зрение у специалиста.')
  }

  score = Math.min(100, score)

  if (sessionDurationMs < WARNING_SUPPRESSION_MS) {
    const suppressionRemainingMs = WARNING_SUPPRESSION_MS - sessionDurationMs
    const remainingMinutes = Math.max(1, Math.ceil(suppressionRemainingMs / 60_000))
    return {
      score,
      level: 'collecting',
      title: 'Наблюдение без предупреждений',
      explanation: `Первые 15 минут система только собирает данные. Оповещения включатся примерно через ${remainingMinutes} мин.`,
      factors,
      recommendations: ['Работайте как обычно — анализ и настройка личной нормы уже идут.'],
      alertsSuppressed: true,
      suppressionRemainingMs,
    }
  }

  if (!hasEnoughObservation && factors.length === 0) {
    return initialEyeStrainAssessment
  }

  if (score >= 50) {
    return {
      score,
      level: 'high',
      title: 'Лучше сделать перерыв',
      explanation: 'Совпало несколько признаков повышенного зрительного напряжения.',
      factors,
      recommendations: recommendations.length > 0
        ? recommendations
        : ['Сделайте короткий перерыв без экрана.'],
      alertsSuppressed: false,
      suppressionRemainingMs: 0,
    }
  }

  if (score >= 20) {
    return {
      score,
      level: 'moderate',
      title: 'Глазам может требоваться отдых',
      explanation: 'Есть отдельные признаки возможного зрительного напряжения.',
      factors,
      recommendations,
      alertsSuppressed: false,
      suppressionRemainingMs: 0,
    }
  }

  return {
    score,
    level: 'low',
    title: 'Нагрузка выглядит комфортной',
    explanation: 'Выраженных признаков зрительного напряжения сейчас не видно.',
    factors,
    recommendations: ['Продолжайте работать в удобном темпе и делайте регулярные перерывы.'],
    alertsSuppressed: false,
    suppressionRemainingMs: 0,
  }
}
