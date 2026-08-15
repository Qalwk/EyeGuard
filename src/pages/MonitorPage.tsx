import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppLayout } from '../components/AppLayout'
import { useEyeMonitoring } from '../hooks/useEyeMonitoring'
import { APP_LABELS, getStatusBadgeText } from '../lib/appLabels'
import { formatSessionDuration } from '../lib/eyeMetrics'

export function MonitorPage() {
  const displayStreamRef = useRef<MediaStream | null>(null)
  const isStoppingTabShareRef = useRef(false)
  const [isTabShared, setIsTabShared] = useState(false)
  const [shareError, setShareError] = useState('')
  const {
    videoRef,
    canvasRef,
    isMonitoring,
    errorMessage,
    dashboard,
    startMonitoring,
    stopMonitoring,
    sensitivity,
    setSensitivity,
    calibration,
    isCalibrating,
    calibrationProgress,
    calibrationMessage,
    startCalibration,
    isPaused,
    setPaused,
  } = useEyeMonitoring()

  const statusText = useMemo(
    () => getStatusBadgeText(dashboard.status, errorMessage),
    [dashboard.status, errorMessage],
  )

  const stopTabShare = useCallback(() => {
    isStoppingTabShareRef.current = true
    displayStreamRef.current?.getTracks().forEach((track) => track.stop())
    displayStreamRef.current = null
    setIsTabShared(false)
    window.setTimeout(() => {
      isStoppingTabShareRef.current = false
    }, 0)
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
        if (!isStoppingTabShareRef.current) {
          setShareError(
            'Демонстрация вкладки была остановлена браузером. Мониторинг камеры продолжается.',
          )
        }
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
          <button className="secondary-button" type="button" onClick={() => setPaused(!isPaused)} disabled={!isMonitoring}>
            {isPaused ? 'Продолжить сессию' : 'Поставить на паузу'}
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
            <h2>Присутствие у экрана</h2>
            <p>{calibration ? 'Обычное положение сохранено для этой камеры.' : 'Настройте обычное положение, чтобы отслеживание было точнее.'}</p>
            <label className="settings-label" htmlFor="presence-sensitivity">Чувствительность</label>
            <select id="presence-sensitivity" className="settings-select" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as 'soft' | 'normal' | 'strict')}>
              <option value="soft">Мягкая</option>
              <option value="normal">Обычная</option>
              <option value="strict">Строгая</option>
            </select>
            <button className="secondary-button calibration-button" type="button" disabled={!isMonitoring || isCalibrating} onClick={startCalibration}>
              {calibration ? 'Перенастроить' : 'Настроить положение'}
            </button>
            {isCalibrating ? <div className="calibration-progress" aria-live="polite"><span style={{ width: `${calibrationProgress}%` }} /></div> : null}
            {calibrationMessage ? <p className="calibration-message" aria-live="polite">{calibrationMessage}</p> : null}
          </article>
          <article className={dashboard.attentionStatus === 'away' ? 'warning-card warning-card-active' : 'warning-card'}>
            <h2>Внимание</h2>
            <p className={dashboard.attentionStatus === 'away' ? 'warning-text' : ''}>{dashboard.attentionStatus === 'active' ? 'Вы у экрана' : dashboard.attentionStatus === 'away' ? 'Похоже, вы отвлеклись' : dashboard.attentionStatus === 'paused' ? 'Сессия на паузе' : 'Камера не уверена'}</p>
            {dashboard.status === 'error' && errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          </article>
        </aside>
      </section>

      <section className="metrics-grid">
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
