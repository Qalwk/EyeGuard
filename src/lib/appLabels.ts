export const APP_LABELS = {
  videoStreamTitle: 'Видеопоток',
  faceRecognitionLabel: 'Распознавание лица',
  faceDetected: 'Лицо обнаружено',
  faceWaiting: 'Ожидание лица в кадре',
  earLabel: 'Текущее значение EAR',
  userStateTitle: 'Состояние пользователя',
  fatigueLevelTitle: 'Текущий уровень утомления',
  blinkCountTitle: 'Количество морганий',
  blinkRateTitle: 'Частота морганий',
  averageBlinkDurationTitle: 'Средняя длительность моргания',
  startMonitoringButton: 'Запустить мониторинг',
  statusStarting: 'Подготовка камеры и загрузка модели',
  statusTracking: 'Активное отслеживание',
  statusWarning: 'Обнаружены признаки утомления',
  statusFaceMissing: 'Лицо не найдено в кадре',
  statusIdle: 'Система готова к запуску',
  userStateNormal: 'Показатель утомления находится в допустимых пределах.',
  userStateWarning:
    'Показатель утомления превысил заданный порог. Рекомендуется сделать перерыв.',
} as const

export type MonitoringUiStatus = 'idle' | 'starting' | 'tracking' | 'warning' | 'face-missing' | 'error'

export function resolveMonitoringStatus(
  fatigueScore: number,
  threshold: number,
  blinkRatePerMinute: number,
  highBlinkRateWarning = 15,
): 'tracking' | 'warning' {
  if (blinkRatePerMinute >= highBlinkRateWarning) {
    return 'warning'
  }

  return fatigueScore >= threshold ? 'warning' : 'tracking'
}

export function getStatusBadgeText(status: MonitoringUiStatus, errorMessage = '') {
  switch (status) {
    case 'starting':
      return APP_LABELS.statusStarting
    case 'tracking':
      return APP_LABELS.statusTracking
    case 'warning':
      return APP_LABELS.statusWarning
    case 'face-missing':
      return APP_LABELS.statusFaceMissing
    case 'error':
      return errorMessage || 'Произошла ошибка во время запуска'
    default:
      return APP_LABELS.statusIdle
  }
}

export function getUserStateText(status: MonitoringUiStatus) {
  return status === 'warning' ? APP_LABELS.userStateWarning : APP_LABELS.userStateNormal
}

export function formatFatigueLevel(score: number) {
  return `${score} / 100`
}
