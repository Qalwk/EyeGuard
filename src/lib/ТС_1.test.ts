import { describe, expect, it } from 'vitest'
import { APP_LABELS, getStatusBadgeText } from './appLabels'
import { validateThresholdInput } from './formValidation'

describe('ТС_1 - запуск мониторинга', () => {
  it('содержит блок «Видеопоток» и нейтральные подписи лица и EAR', () => {
    expect(APP_LABELS.videoStreamTitle).toBe('Видеопоток')
    expect(APP_LABELS.faceRecognitionLabel).toBe('Лицо в кадре')
    expect(APP_LABELS.earLabel).toBe('Текущее значение EAR')
    expect(APP_LABELS.faceDetected).toBe('Лицо обнаружено')
  })

  it('при активном отслеживании бейдж показывает «Активное отслеживание»', () => {
    expect(getStatusBadgeText('tracking')).toBe('Активное отслеживание')
  })

  it('при подготовке камеры бейдж показывает текст подготовки', () => {
    expect(getStatusBadgeText('starting')).toBe('Подготовка камеры и загрузка модели')
  })

  it('порог сигнала для перерыва принимает значения от 10 до 100', () => {
    expect(validateThresholdInput('10')).toEqual({ value: 10, error: '' })
    expect(validateThresholdInput('100')).toEqual({ value: 100, error: '' })
  })

  it('порог сигнала для перерыва отклоняет некорректные значения', () => {
    expect(validateThresholdInput('')).toMatchObject({ value: null })
    expect(validateThresholdInput('abc')).toMatchObject({ value: null })
    expect(validateThresholdInput('9')).toMatchObject({ value: null })
    expect(validateThresholdInput('101')).toMatchObject({ value: null })
  })
})
