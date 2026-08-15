import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppLayout } from '../components/AppLayout'
import { loadStoredThreshold, useEyeMonitoring } from '../hooks/useEyeMonitoring'
import { APP_LABELS, getStatusBadgeText, getUserStateText } from '../lib/appLabels'
import { formatSessionDuration } from '../lib/eyeMetrics'
import { clampThreshold, THRESHOLD_MAX, THRESHOLD_MIN, validateThresholdInput } from '../lib/formValidation'

export function MonitorPage() {
  const displayStreamRef = useRef<MediaStream | null>(null)
  const [thresholdInput, setThresholdInput] = useState(() => String(loadStoredThreshold()))
  const [thresholdError, setThresholdError] = useState('')
  const [isTabShared, setIsTabShared] = useState(false)
  const [shareError, setShareError] = useState('')
  const {
    videoRef,
    canvasRef,
    threshold,
    setThreshold,
    isMonitoring,
    errorMessage,
    dashboard,
    startMonitoring,
    stopMonitoring,
  } = useEyeMonitoring()

  const statusText = useMemo(
    () => getStatusBadgeText(dashboard.status, errorMessage),
    [dashboard.status, errorMessage],
  )

  const stopTabShare = useCallback(() => {
    displayStreamRef.current?.getTracks().forEach((track) => track.stop())
    displayStreamRef.current = null
    setIsTabShared(false)
  }, [])

  useEffect(() => stopTabShare, [stopTabShare])

  const handleStartTabShareMonitoring = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setShareError('Этот браузер не поддерживает демонстрацию вкладки.')
      return
    }

    setShareError('')
    stopMonitoring()
    stopTabShare()

    try {
      // Called directly from the click handler: the browser shows its own sharing UI and safety bar.
      // These Chromium hints are deliberately optional: unsupported browsers simply ignore them.
      const displayMediaOptions = {
        audio: false,
        video: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions & Record<string, unknown>
      const displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)

      displayStreamRef.current = displayStream
      setIsTabShared(true)
      displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        displayStreamRef.current = null
        setIsTabShared(false)
        stopMonitoring()
      })

      await startMonitoring()
    } catch (error) {
      stopTabShare()
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setShareError('Демонстрация вкладки не запущена: доступ был отменён или запрещён.')
      } else {
        setShareError('Не удалось запустить демонстрацию вкладки.')
      }
    }
  }

  const handleStopMonitoring = () => {
    stopMonitoring()
    stopTabShare()
  }

  const handleThresholdChange = (value: number) => {
    const nextValue = clampThreshold(value)
    setThreshold(nextValue)
    setThresholdInput(String(nextValue))
    setThresholdError('')
  }

  const handleThresholdInputBlur = () => {
    const validationResult = validateThresholdInput(thresholdInput)
    if (validationResult.error || validationResult.value === null) {
      setThresholdError(validationResult.error)
      setThresholdInput(String(threshold))
      return
    }

    setThreshold(validationResult.value)
    setThresholdInput(String(validationResult.value))
    setThresholdError('')
  }

  return (
    <AppLayout
      title="Оценка утомления по морганию в реальном времени"
      description="Включите режим демонстрации этой вкладки, чтобы браузер показывал системную панель безопасности во время проверки фонового анализа."
      actions={
        <div className="hero-actions hero-actions-column">
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleStartTabShareMonitoring()}
            disabled={isTabShared}
          >
            {isTabShared ? 'Демонстрация вкладки включена' : 'Запустить через демонстрацию вкладки'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void startMonitoring()}
            disabled={isMonitoring || isTabShared}
          >
            {APP_LABELS.startMonitoringButton}
          </button>
          <button className="secondary-button" type="button" onClick={handleStopMonitoring} disabled={!isMonitoring && !isTabShared}>
            Остановить
          </button>
        </div>
      }
    >
      {isTabShared ? (
        <section className="share-status-panel" aria-live="polite">
          <div>
            <strong>Демонстрация вкладки активна</strong>
            <span>Не закрывайте системную панель браузера. Выберите «Эта вкладка» в диалоге доступа.</span>
          </div>
          <strong>Обработано кадров: {dashboard.processedFrameCount}</strong>
        </section>
      ) : null}
      {shareError ? <p className="form-error" role="alert">{shareError}</p> : null}

      <section className="workspace-grid">
        <article className="video-card">
          <div className="card-header">
            <div>
              <h2>{APP_LABELS.videoStreamTitle}</h2>
              <p>Вся обработка выполняется локально в браузере пользователя.</p>
            </div>
            <span className={`status-badge status-${dashboard.status}`}>{statusText}</span>
          </div>
          <div className="video-stage">
            <video ref={videoRef} className="camera-layer" autoPlay muted playsInline />
            <canvas ref={canvasRef} className="overlay-layer" />
            {!isMonitoring ? (
              <div className="video-placeholder">
                <strong>Камера ещё не активна</strong>
                <span>Нажмите кнопку запуска, чтобы начать анализ моргания.</span>
              </div>
            ) : null}
          </div>
          <div className="video-footer">
            <div>
              <span className="footer-label">{APP_LABELS.faceRecognitionLabel}</span>
              <strong>{dashboard.hasFace ? APP_LABELS.faceDetected : APP_LABELS.faceWaiting}</strong>
            </div>
            <div>
              <span className="footer-label">{APP_LABELS.earLabel}</span>
              <strong>{dashboard.currentEar.toFixed(3)}</strong>
            </div>
          </div>
        </article>

        <aside className="sidebar">
          <article className="settings-card">
            <h2>Порог утомления</h2>
            <p>Значение хранится в localStorage и используется для определения предупреждения.</p>
            <div className="threshold-control">
              <input type="range" min={THRESHOLD_MIN} max={THRESHOLD_MAX} step="1" value={threshold} onChange={(event) => handleThresholdChange(Number(event.target.value))} />
              <input type="number" min={THRESHOLD_MIN} max={THRESHOLD_MAX} value={thresholdInput} onChange={(event) => { setThresholdInput(event.target.value); setThresholdError('') }} onBlur={handleThresholdInputBlur} aria-invalid={Boolean(thresholdError)} />
            </div>
            {thresholdError ? <p className="field-error threshold-error" role="alert">{thresholdError}</p> : null}
            <div className="threshold-hint">Допустимый диапазон: {THRESHOLD_MIN}–{THRESHOLD_MAX}. Текущее значение: <strong>{threshold}</strong></div>
          </article>
          <article className={dashboard.status === 'warning' ? 'warning-card warning-card-active' : 'warning-card'}>
            <h2>{APP_LABELS.userStateTitle}</h2>
            <p className={dashboard.status === 'warning' ? 'warning-text' : ''}>{getUserStateText(dashboard.status)}</p>
            {dashboard.status === 'error' && errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          </article>
        </aside>
      </section>

      <section className="metrics-grid">
        <article className="metric-card"><span>Обработано кадров</span><strong>{dashboard.processedFrameCount}</strong></article>
        <article className="metric-card"><span>{APP_LABELS.blinkCountTitle}</span><strong>{dashboard.blinkCount}</strong></article>
        <article className="metric-card"><span>Длительность сеанса</span><strong>{formatSessionDuration(dashboard.sessionDurationMs)}</strong></article>
        <article className="metric-card"><span>{APP_LABELS.blinkRateTitle}</span><strong>{dashboard.fatigueMetrics.blinkRatePerMinute} / мин</strong></article>
        <article className="metric-card"><span>{APP_LABELS.averageBlinkDurationTitle}</span><strong>{Math.round(dashboard.fatigueMetrics.averageBlinkDurationMs)} мс</strong></article>
        <article className="metric-card"><span>Доля времени с закрытыми глазами</span><strong>{(dashboard.fatigueMetrics.eyeClosureRatio * 100).toFixed(1)}%</strong></article>
        <article className="metric-card accent-card"><span>{APP_LABELS.fatigueLevelTitle}</span><strong>{dashboard.fatigueMetrics.fatigueScore} / 100</strong></article>
      </section>
    </AppLayout>
  )
}
