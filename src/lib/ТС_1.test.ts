import { describe, expect, it } from 'vitest'
import { APP_LABELS, getStatusBadgeText } from './appLabels'
import { hasAuthErrors, validateAuthForm, validateThresholdInput } from './formValidation'

describe('ТС_1 — запуск мониторинга', () => {
  it('содержит блок «Видеопоток» и подписи распознавания лица и EAR', () => {
    expect(APP_LABELS.videoStreamTitle).toBe('Видеопоток')
    expect(APP_LABELS.faceRecognitionLabel).toBe('Распознавание лица')
    expect(APP_LABELS.earLabel).toBe('Текущее значение EAR')
    expect(APP_LABELS.faceDetected).toBe('Лицо обнаружено')
  })

  it('при активном отслеживании бейдж показывает «Активное отслеживание»', () => {
    expect(getStatusBadgeText('tracking')).toBe('Активное отслеживание')
  })

  it('при подготовке камеры бейдж показывает текст подготовки', () => {
    expect(getStatusBadgeText('starting')).toBe('Подготовка камеры и загрузка модели')
  })

  it('форма регистрации отклоняет некорректные поля', () => {
    const errors = validateAuthForm('register', {
      fullName: 'И',
      email: 'not-an-email',
      login: 'ab',
      password: '123',
      confirmPassword: '456',
    })

    expect(hasAuthErrors(errors)).toBe(true)
  })

  it('форма регистрации принимает корректные данные', () => {
    const errors = validateAuthForm('register', {
      fullName: 'Иванов Иван',
      email: 'user@mail.ru',
      login: 'ivanov',
      password: 'secret123',
      confirmPassword: 'secret123',
    })

    expect(hasAuthErrors(errors)).toBe(false)
  })

  it('форма регистрации отклоняет больше двух слов в имени', () => {
    const errors = validateAuthForm('register', {
      fullName: 'ывфа фыв фвыаыф фвы',
      email: 'user@mail.ru',
      login: 'ivanov',
      password: 'secret123',
      confirmPassword: 'secret123',
    })

    expect(errors.fullName).toBeTruthy()
    expect(hasAuthErrors(errors)).toBe(true)
  })

  it('форма входа требует логин и пароль', () => {
    const errors = validateAuthForm('login', {
      fullName: '',
      email: '',
      login: '',
      password: '',
      confirmPassword: '',
    })

    expect(errors.login).toBeTruthy()
    expect(errors.password).toBeTruthy()
  })

  it('порог утомления принимает значения от 10 до 100', () => {
    expect(validateThresholdInput('10')).toEqual({ value: 10, error: '' })
    expect(validateThresholdInput('100')).toEqual({ value: 100, error: '' })
  })

  it('порог утомления отклоняет некорректные значения', () => {
    expect(validateThresholdInput('')).toMatchObject({ value: null })
    expect(validateThresholdInput('abc')).toMatchObject({ value: null })
    expect(validateThresholdInput('9')).toMatchObject({ value: null })
    expect(validateThresholdInput('101')).toMatchObject({ value: null })
  })
})
