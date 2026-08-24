import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AppLayout } from '../components/AppLayout'
import { SessionSummary } from '../components/SessionSummary'
import wellnessHero from '../assets/eyeguard-wellness-hero.png'
import { useAuth } from '../context/AuthContext'
import { type WorkSessionSetup, useEyeMonitoring } from '../hooks/useEyeMonitoring'
import { APP_LABELS, getStatusBadgeText } from '../lib/appLabels'
import { formatSessionDuration } from '../lib/eyeMetrics'
import { ownerIdForUser } from '../lib/workSessions'
import { findWorkTask, loadWorkTasks, saveWorkTask, type WorkTask } from '../lib/workTasks'

type SessionMode = 'free' | 'pomodoro' | 'smart-pomodoro'
type PomodoroPhase = 'focus' | 'break'

const DURATION_OPTIONS = [25, 45, 60] as const
const CAMERA_NOTICE_STORAGE_KEY = 'eyeguard-camera-notice-v1'

function playPhaseSound(context: AudioContext | null) {
  if (!context) return
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = 740
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.36)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.38)
}

export function MonitorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { currentUser } = useAuth()
  const ownerId = ownerIdForUser(currentUser?.id ?? 0)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const isStoppingTabShareRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const phaseRef = useRef<PomodoroPhase>('focus')
  const remainingRef = useRef(0)
  const lastTickRef = useRef(0)
  const lastActiveTimeRef = useRef(0)
  const activeTimeRef = useRef(0)
  const [isTabShared, setIsTabShared] = useState(false)
  const [shareError, setShareError] = useState('')
  const [mode, setMode] = useState<SessionMode>('free')
  const [focusMinutes, setFocusMinutes] = useState('25')
  const [breakMinutes, setBreakMinutes] = useState('5')
  const [sessionGoal, setSessionGoal] = useState('')
  const [activeTask, setActiveTask] = useState<WorkTask | null>(null)
  const [phase, setPhase] = useState<PomodoroPhase>('focus')
  const [phaseRemainingMs, setPhaseRemainingMs] = useState(0)
  const [showCameraNotice, setShowCameraNotice] = useState(false)
  const [hasAcceptedCameraNotice, setHasAcceptedCameraNotice] = useState(
    () => window.localStorage.getItem(CAMERA_NOTICE_STORAGE_KEY) === 'accepted',
  )
  const {
    videoRef, canvasRef, isMonitoring, errorMessage, dashboard, startMonitoring, stopMonitoring,
    sensitivity, setSensitivity, calibration, isCalibrating, calibrationProgress,
    calibrationMessage, startCalibration, isPaused, setPaused, setSessionPhase,
    completedSession, sessionSaveError, retryCompletedSessionSave, clearCompletedSession,
  } = useEyeMonitoring()

  const statusText = useMemo(() => getStatusBadgeText(dashboard.status, errorMessage), [dashboard.status, errorMessage])
  const focusDurationMinutes = Math.min(Math.max(Number(focusMinutes) || 25, 1), 480)
  const breakDurationMinutes = Math.min(Math.max(Number(breakMinutes) || 5, 1), 180)
  const availableTasks = useMemo(() => loadWorkTasks(ownerId), [ownerId])
  const sessionSetup = useMemo<WorkSessionSetup>(() => ({ mode, taskId: activeTask?.id, plannedDurationMinutes: mode === 'free' ? undefined : focusDurationMinutes, breakDurationMinutes: mode === 'free' ? undefined : breakDurationMinutes, goal: sessionGoal, ownerId }), [activeTask?.id, breakDurationMinutes, focusDurationMinutes, mode, ownerId, sessionGoal])

  useEffect(() => {
    const taskId = searchParams.get('task')
    if (!taskId || isMonitoring) return
    const task = findWorkTask(ownerId, taskId)
    if (!task) return
    setActiveTask(task)
    setSessionGoal(task.title)
  }, [isMonitoring, ownerId, searchParams])

  useEffect(() => {
    activeTimeRef.current = dashboard.activeSessionDurationMs
  }, [dashboard.activeSessionDurationMs])

  const resetPomodoro = useCallback(() => {
    const focusMs = focusDurationMinutes * 60_000
    phaseRef.current = 'focus'
    remainingRef.current = focusMs
    lastTickRef.current = Date.now()
    lastActiveTimeRef.current = activeTimeRef.current
    setPhase('focus')
    setSessionPhase('focus')
    setPhaseRemainingMs(focusMs)
  }, [focusDurationMinutes, setSessionPhase])

  const stopTabShare = useCallback(() => {
    isStoppingTabShareRef.current = true
    displayStreamRef.current?.getTracks().forEach((track) => track.stop())
    displayStreamRef.current = null
    setIsTabShared(false)
    window.setTimeout(() => { isStoppingTabShareRef.current = false }, 0)
  }, [])

  useEffect(() => () => { stopTabShare(); audioContextRef.current?.close().catch(() => undefined) }, [stopTabShare])

  useEffect(() => {
    if (!isMonitoring || mode === 'free' || isPaused) return
    lastTickRef.current = Date.now()
    lastActiveTimeRef.current = activeTimeRef.current
    const interval = window.setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastTickRef.current
      lastTickRef.current = now
      const smartFocus = mode === 'smart-pomodoro' && phaseRef.current === 'focus'
      const activeElapsed = Math.max(0, activeTimeRef.current - lastActiveTimeRef.current)
      lastActiveTimeRef.current = activeTimeRef.current
      const tick = smartFocus ? activeElapsed : elapsed
      if (tick === 0) return
      const remaining = Math.max(0, remainingRef.current - tick)
      remainingRef.current = remaining
      setPhaseRemainingMs(remaining)
      if (remaining > 0) return
      const nextPhase: PomodoroPhase = phaseRef.current === 'focus' ? 'break' : 'focus'
      const nextMs = (nextPhase === 'focus' ? focusDurationMinutes : breakDurationMinutes) * 60_000
      phaseRef.current = nextPhase
      remainingRef.current = nextMs
      lastActiveTimeRef.current = activeTimeRef.current
      setPhase(nextPhase)
      setSessionPhase(nextPhase)
      setPhaseRemainingMs(nextMs)
      playPhaseSound(audioContextRef.current)
    }, 200)
    return () => window.clearInterval(interval)
  }, [breakDurationMinutes, focusDurationMinutes, isMonitoring, isPaused, mode, setSessionPhase])

  const handleTaskSelection = (taskId: string) => {
    const task = availableTasks.find((item) => item.id === taskId) ?? null
    if (!task) {
      if (activeTask && sessionGoal === activeTask.title) setSessionGoal('')
      setActiveTask(null)
      navigate('/', { replace: true })
      return
    }
    setActiveTask(task)
    setSessionGoal(task.title)
    navigate(`/?task=${encodeURIComponent(task.id)}`, { replace: true })
  }

  const handleStartTabShareMonitoring = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return setShareError('Этот браузер не поддерживает демонстрацию вкладки.')
    setShareError('')
    stopTabShare()
    resetPomodoro()
    try {
      audioContextRef.current ??= new AudioContext()
      await audioContextRef.current.resume()
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' } as DisplayMediaStreamOptions & Record<string, unknown>)
      displayStreamRef.current = stream
      setIsTabShared(true)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { displayStreamRef.current = null; setIsTabShared(false); if (!isStoppingTabShareRef.current) setShareError('Демонстрация вкладки была остановлена браузером.') })
      if (activeTask?.status === 'planned') {
        const startedTask: WorkTask = { ...activeTask, status: 'in-progress', updatedAt: new Date().toISOString() }
        saveWorkTask(startedTask)
        setActiveTask(startedTask)
      }
      await startMonitoring(sessionSetup)
    } catch (error) {
      stopTabShare()
      setShareError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Демонстрация вкладки не запущена: доступ был отменён или запрещён.' : 'Не удалось запустить демонстрацию вкладки.')
    }
  }

  const handleStartRequest = () => {
    if (hasAcceptedCameraNotice) {
      void handleStartTabShareMonitoring()
      return
    }

    setShowCameraNotice(true)
  }

  const handleConfirmCameraNotice = () => {
    window.localStorage.setItem(CAMERA_NOTICE_STORAGE_KEY, 'accepted')
    setHasAcceptedCameraNotice(true)
    setShowCameraNotice(false)
    void handleStartTabShareMonitoring()
  }

  const handleStop = async () => { stopTabShare(); await stopMonitoring() }
  const adjustPhaseTime = (minutes: number) => {
    const nextRemaining = Math.max(0, remainingRef.current + minutes * 60_000)
    remainingRef.current = nextRemaining
    setPhaseRemainingMs(nextRemaining)
  }
  const attentionText = dashboard.attentionStatus === 'active' ? 'Вы у экрана' : dashboard.attentionStatus === 'away' ? 'Похоже, вы отвлеклись' : dashboard.attentionStatus === 'paused' ? 'Сессия на паузе' : 'Камера не уверена'
  const smartWaiting = mode === 'smart-pomodoro' && phase === 'focus' && dashboard.attentionStatus !== 'active'
  const eyeComfort = dashboard.eyeStrainAssessment
  const blinkRateText = dashboard.fatigueMetrics.observationDurationMs < 10_000
    ? 'Собираем данные'
    : `${dashboard.fatigueMetrics.estimatedBlinkRatePerMinute.toFixed(1)} / мин`

  if (completedSession) {
    return <AppLayout title="Итог сессии" description="Короткий и понятный результат без технических метрик." variant="wellness">
      <SessionSummary
        session={completedSession}
        saveError={sessionSaveError}
        onRetrySave={() => void retryCompletedSessionSave()}
        onNewSession={() => { clearCompletedSession(); setSessionGoal(''); resetPomodoro() }}
        onViewHistory={() => navigate('/history')}
      />
    </AppLayout>
  }

  return <AppLayout
    title="Внимательная рабочая сессия"
    description="Запустите спокойную сессию, чтобы бережнее работать за экраном. Камера обрабатывается только в вашем браузере."
    variant="wellness"
  >
    {shareError ? <p className="form-error" role="alert">{shareError}</p> : null}
    {showCameraNotice ? (
      <div className="camera-notice-backdrop">
        <section
          className="camera-notice-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="camera-notice-title"
          aria-describedby="camera-notice-description"
        >
          <span className="eyebrow">Перед запуском</span>
          <h2 id="camera-notice-title">EyeGuard запросит доступ к камере</h2>
          <p id="camera-notice-description">
            Камера нужна для локального определения лица в кадре, положения головы и
            показателей моргания во время рабочей сессии.
          </p>
          <ul>
            <li>Видео, кадры и точки лица не отправляются владельцу проекта.</li>
            <li>Итоги сессии и настройки сохраняются только в этом браузере.</li>
            <li>После завершения мониторинга использование камеры прекращается.</li>
          </ul>
          <p className="camera-notice-secondary">
            Браузер также запросит демонстрацию текущей вкладки, а затем разрешение на камеру.
            Подробнее - в <Link to="/policy">политике приватности</Link>.
          </p>
          <div className="camera-notice-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowCameraNotice(false)}
            >
              Отмена
            </button>
            <button className="primary-button" type="button" onClick={handleConfirmCameraNotice}>
              Понятно, продолжить
            </button>
          </div>
        </section>
      </div>
    ) : null}
    {!isMonitoring ? <section className="session-setup-card">
      <div>
        <h2>{activeTask ? 'Продолжить задачу' : 'Выберите режим'}</h2>
        <p>{activeTask ? 'Сессия будет записана в карточку, а работа может продолжаться и после 100%.' : 'Можно указать цель вручную или выбрать одну из своих задач.'}</p>
        {activeTask ? <div className="monitor-task-context" style={{ '--task-color': activeTask.color } as CSSProperties}><i /><span><small>Задача</small><strong>{activeTask.title}</strong></span><button type="button" onClick={() => handleTaskSelection('')}>Отвязать</button></div> : null}
      </div>
      <div className="session-setup-fields">
        <label>Режим<select value={mode} onChange={(event) => setMode(event.target.value as SessionMode)}><option value="free">Свободный режим</option><option value="pomodoro">Помодоро</option><option value="smart-pomodoro">Умный помодоро</option></select></label>
        {mode !== 'free' ? <><label>Работа, мин.<select value={focusMinutes} onChange={(event) => setFocusMinutes(event.target.value)}>{DURATION_OPTIONS.map((value) => <option key={value} value={value}>{value} минут</option>)}</select></label><label>Перерыв, мин.<input type="number" min="1" max="180" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></label></> : null}
        <label className="session-task-field">Задача (необязательно)<select value={activeTask?.id ?? ''} onChange={(event) => handleTaskSelection(event.target.value)}><option value="">Без привязки к задаче</option>{availableTasks.filter((task) => task.status === 'in-progress').length ? <optgroup label="Сегодня">{availableTasks.filter((task) => task.status === 'in-progress').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</optgroup> : null}{availableTasks.filter((task) => task.status === 'planned').length ? <optgroup label="Бэклог">{availableTasks.filter((task) => task.status === 'planned').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</optgroup> : null}{availableTasks.filter((task) => task.status === 'done').length ? <optgroup label="Выполнено">{availableTasks.filter((task) => task.status === 'done').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</optgroup> : null}</select></label>
        <label className="session-goal-field">Цель (необязательно)<input value={sessionGoal} maxLength={160} placeholder="Например, подготовить отчёт" onChange={(event) => setSessionGoal(event.target.value)} /></label>
        <button className="primary-button session-start-button" type="button" onClick={handleStartRequest} disabled={isTabShared}>{isTabShared ? 'Демонстрация вкладки включена' : activeTask ? 'Начать работу над задачей' : 'Запустить через демонстрацию вкладки'}</button>
      </div>
    </section> : null}
    {isMonitoring ? <section className="pomodoro-panel session-control-panel" aria-live="polite"><span>{mode === 'free' ? 'Свободный режим' : phase === 'focus' ? 'Работа' : 'Перерыв'}</span><div className="timer-adjuster">{mode !== 'free' ? <button className="timer-adjust-button" type="button" onClick={() => adjustPhaseTime(-5)} aria-label="Убавить 5 минут">−</button> : null}<strong>{formatSessionDuration(mode === 'free' ? dashboard.activeSessionDurationMs : phaseRemainingMs)}</strong>{mode !== 'free' ? <button className="timer-adjust-button" type="button" onClick={() => adjustPhaseTime(5)} aria-label="Добавить 5 минут">+</button> : null}</div><p>{mode === 'free' ? `Активное время. ${attentionText}` : phase === 'break' ? 'Время отдыха идёт независимо от внимания.' : smartWaiting ? `Рабочий таймер ждёт: ${attentionText.toLowerCase()}.` : mode === 'smart-pomodoro' ? 'Рабочий таймер идёт только когда вы у экрана.' : 'Рабочий таймер идёт непрерывно.'}</p><div className="session-control-actions"><button className="secondary-button" type="button" onClick={() => setPaused(!isPaused)}>{isPaused ? 'Продолжить' : 'Поставить на паузу'}</button><button className="secondary-button session-end-button" type="button" onClick={() => void handleStop()}>{mode === 'free' ? 'Завершить сессию' : 'Завершить стрик'}</button></div></section> : null}
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
          {!isMonitoring ? <div className="video-placeholder video-placeholder-wellness">
            <div className="video-placeholder-copy">
              <strong>Камера ещё не активна</strong>
              <span>Выберите режим и начните через демонстрацию вкладки.</span>
            </div>
            <img src={wellnessHero} alt="Иллюстрация рабочего места EyeGuard" />
          </div> : null}
        </div>
        <div className="video-footer">
          <div>
            <span className="footer-label">{APP_LABELS.faceRecognitionLabel}</span>
            <strong>{dashboard.hasFace ? APP_LABELS.faceDetected : APP_LABELS.faceWaiting}</strong>
          </div>
          <div>
            <span className="footer-label">Непрерывная работа</span>
            <strong>{formatSessionDuration(dashboard.continuousFocusDurationMs)}</strong>
          </div>
        </div>
      </article>
      <aside className="sidebar">
        <article className={`eye-comfort-card eye-comfort-${eyeComfort.level}`} aria-live="polite">
          <div className="eye-comfort-heading">
            <h2>Ритм и перерывы</h2>
            <span>{eyeComfort.alertsSuppressed ? 'тихий период' : `${eyeComfort.score} / 100`}</span>
          </div>
          <strong className="eye-comfort-title">{eyeComfort.title}</strong>
          <p>{eyeComfort.explanation}</p>
          <ul>
            {eyeComfort.recommendations.map((recommendation) => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ul>
          <small>Это ориентир для перерыва, а не оценка здоровья.</small>
        </article>
        <article className="settings-card">
          <h2>Присутствие у экрана</h2>
          <p>{calibration ? 'Обычное положение сохранено для этой камеры.' : 'Настройте обычное положение, чтобы отслеживание было точнее.'}</p>
          <label className="settings-label" htmlFor="presence-sensitivity">Чувствительность</label>
          <select id="presence-sensitivity" className="settings-select" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as 'soft' | 'normal' | 'strict')}>
            <option value="soft">Мягкая</option>
            <option value="normal">Обычная</option>
            <option value="strict">Строгая</option>
          </select>
          <button className="secondary-button calibration-button" type="button" disabled={!isMonitoring || isCalibrating} onClick={startCalibration}>{calibration ? 'Перенастроить' : 'Настроить положение'}</button>
          {isCalibrating ? <div className="calibration-progress" aria-live="polite"><span style={{ width: `${calibrationProgress}%` }} /></div> : null}
          {calibrationMessage ? <p className="calibration-message" aria-live="polite">{calibrationMessage}</p> : null}
        </article>
        <article className={dashboard.attentionStatus === 'away' ? 'warning-card warning-card-active' : 'warning-card'}>
          <h2>Внимание</h2>
          <p className={dashboard.attentionStatus === 'away' ? 'warning-text' : ''}>{attentionText}</p>
        </article>
      </aside>
    </section>
    <section className="metrics-grid">
      <article className="metric-card accent-card"><span>Активное время</span><strong>{formatSessionDuration(dashboard.activeSessionDurationMs)}</strong></article>
      <article className="metric-card"><span>Общее время</span><strong>{formatSessionDuration(dashboard.sessionDurationMs)}</strong></article>
      <article className="metric-card"><span>Отвлечённое время</span><strong>{formatSessionDuration(dashboard.awayDurationMs)}</strong></article>
      <article className="metric-card"><span>{APP_LABELS.blinkCountTitle}</span><strong>{dashboard.blinkCount}</strong></article>
      <article className="metric-card"><span>{APP_LABELS.blinkRateTitle}</span><strong>{blinkRateText}</strong></article>
      <article className="metric-card"><span>Неполные моргания, примерно</span><strong>{dashboard.fatigueMetrics.characterizedBlinkCount > 0 ? `${Math.round(dashboard.fatigueMetrics.incompleteBlinkRatio * 100)}%` : '-'}</strong></article>
    </section>
  </AppLayout>
}
