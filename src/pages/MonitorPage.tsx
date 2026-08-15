import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import {
  buildFatigueMetrics,
  calculateAverageEar,
  formatSessionDuration,
  type BlinkEvent,
  type FatigueMetrics,
} from '../lib/eyeMetrics'
import {
  APP_LABELS,
  getStatusBadgeText,
  getUserStateText,
  resolveMonitoringStatus,
  type MonitoringUiStatus,
} from '../lib/appLabels'
import {
  clampThreshold,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  validateThresholdInput,
} from '../lib/formValidation'
import { AppLayout } from '../components/AppLayout'

const STORAGE_KEY = 'eyeguard-fatigue-threshold'
const DEFAULT_THRESHOLD = 55
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const EYE_CLOSED_THRESHOLD = 0.21
const EYE_OPEN_THRESHOLD = 0.24
const MIN_BLINK_DURATION_MS = 60
const MAX_BLINK_DURATION_MS = 1200
const UI_UPDATE_INTERVAL_MS = 180
const FACE_TIMEOUT_MS = 1500

type AppStatus = MonitoringUiStatus

type DashboardState = {
  status: AppStatus
  blinkCount: number
  currentEar: number
  sessionDurationMs: number
  hasFace: boolean
  fatigueMetrics: FatigueMetrics
}

type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

const emptyMetrics: FatigueMetrics = {
  blinkRatePerMinute: 0,
  averageBlinkDurationMs: 0,
  eyeClosureRatio: 0,
  fatigueScore: 0,
}

const initialDashboardState: DashboardState = {
  status: 'idle',
  blinkCount: 0,
  currentEar: 0,
  sessionDurationMs: 0,
  hasFace: false,
  fatigueMetrics: emptyMetrics,
}

function waitForVideoReady(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const handleReady = () => {
      cleanup()
      resolve()
    }

    const handleError = () => {
      cleanup()
      reject(new Error('Не удалось подготовить видеопоток к воспроизведению.'))
    }

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleReady)
      video.removeEventListener('canplay', handleReady)
      video.removeEventListener('error', handleError)
    }

    video.addEventListener('loadedmetadata', handleReady, { once: true })
    video.addEventListener('canplay', handleReady, { once: true })
    video.addEventListener('error', handleError, { once: true })
  })
}

async function getCameraPermissionState(): Promise<CameraPermissionState> {
  if (!('permissions' in navigator) || !navigator.permissions?.query) {
    return 'unsupported'
  }

  try {
    const status = await navigator.permissions.query({
      name: 'camera' as PermissionName,
    })

    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state
    }

    return 'unsupported'
  } catch {
    return 'unsupported'
  }
}

async function requestCameraStream() {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    {
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    {
      audio: false,
      video: true,
    },
  ]

  let lastError: unknown = null

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      lastError = error

      if (
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' ||
          error.name === 'PermissionDeniedError' ||
          error.name === 'SecurityError')
      ) {
        throw error
      }
    }
  }

  throw lastError
}

function getCameraErrorMessage(
  error: unknown,
  permissionState: CameraPermissionState,
  videoInputCount: number,
) {
  if (permissionState === 'denied') {
    return 'Доступ к веб-камере уже заблокирован в браузере. Откройте настройки сайта рядом с адресной строкой и разрешите использование камеры.'
  }

  if (videoInputCount === 0) {
    return 'Браузер не обнаружил ни одной доступной камеры. Проверьте, включено ли устройство и разрешён ли доступ к камере в параметрах Windows.'
  }

  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'Доступ к веб-камере запрещён. Разрешите использование камеры в браузере и повторите запуск.'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'Веб-камера не найдена. Подключите устройство и попробуйте снова.'
      case 'NotReadableError':
      case 'TrackStartError':
        return 'Камера не может быть запущена. Проверьте, не используется ли она другим приложением, и убедитесь, что в параметрах Windows включён доступ приложений к камере.'
      case 'SecurityError':
        return 'Браузер заблокировал доступ к камере по соображениям безопасности. Откройте приложение на `localhost` или через HTTPS.'
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'Камера найдена, но не поддерживает запрошенные параметры. Приложение уже попробовало упрощённый режим, поэтому стоит проверить драйвер камеры или настройки браузера.'
      default:
        return error.message || 'Не удалось получить доступ к веб-камере.'
    }
  }

  if (error instanceof Error) {
    if (error.message === 'Could not start video source') {
      return 'Браузер видит камеру, но не может запустить видеопоток. Чаще всего это связано с блокировкой камеры в Windows, конфликтом драйвера или использованием камеры другой программой.'
    }

    return error.message
  }

  return 'Не удалось получить доступ к веб-камере.'
}

function loadStoredThreshold() {
  const storedValue = window.localStorage.getItem(STORAGE_KEY)
  const parsedValue = Number(storedValue)

  if (!storedValue || Number.isNaN(parsedValue)) {
    return DEFAULT_THRESHOLD
  }

  return clampThreshold(parsedValue)
}

function drawOverlay(
  canvas: HTMLCanvasElement | null,
  result: FaceLandmarkerResult | null,
  hasFace: boolean,
) {
  const context = canvas?.getContext('2d')

  if (!canvas || !context) {
    return
  }

  context.clearRect(0, 0, canvas.width, canvas.height)

  if (!hasFace || !result?.faceLandmarks[0]) {
    return
  }

  const drawingUtils = new DrawingUtils(context)
  const landmarks = result.faceLandmarks[0]

  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
    color: '#64748b',
    lineWidth: 1,
  })
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
    color: '#34d399',
    lineWidth: 2,
  })
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
    color: '#34d399',
    lineWidth: 2,
  })
  drawingUtils.drawLandmarks(landmarks, {
    color: '#8b5cf6',
    radius: 1.2,
  })
}

export function MonitorPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  const thresholdRef = useRef(loadStoredThreshold())
  const sessionStartedAtRef = useRef<number | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const lastFrameTimestampRef = useRef<number | null>(null)
  const lastUiUpdateRef = useRef(0)
  const lastFaceSeenAtRef = useRef<number | null>(null)
  const eyeClosedRef = useRef(false)
  const closedStartedAtRef = useRef<number | null>(null)
  const totalClosedEyeMsRef = useRef(0)
  const blinkEventsRef = useRef<BlinkEvent[]>([])
  const blinkCountRef = useRef(0)

  const [threshold, setThreshold] = useState(() => loadStoredThreshold())
  const [thresholdInput, setThresholdInput] = useState(() => String(loadStoredThreshold()))
  const [thresholdError, setThresholdError] = useState('')
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [dashboard, setDashboard] = useState<DashboardState>(initialDashboardState)

  const statusText = useMemo(() => {
    return getStatusBadgeText(dashboard.status, errorMessage)
  }, [dashboard.status, errorMessage])

  const resetRuntimeData = useCallback(() => {
    sessionStartedAtRef.current = null
    lastVideoTimeRef.current = -1
    lastFrameTimestampRef.current = null
    lastUiUpdateRef.current = 0
    lastFaceSeenAtRef.current = null
    eyeClosedRef.current = false
    closedStartedAtRef.current = null
    totalClosedEyeMsRef.current = 0
    blinkEventsRef.current = []
    blinkCountRef.current = 0
  }, [])

  const syncCanvasWithVideo = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current

    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      return
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }
  }, [])

  const stopMediaStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    const video = videoRef.current

    if (video) {
      video.pause()
      video.srcObject = null
    }
  }, [])

  const stopMonitoring = useCallback(
    (resetView = true) => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      stopMediaStream()
      resetRuntimeData()
      drawOverlay(canvasRef.current, null, false)

      if (resetView) {
        setIsMonitoring(false)
        setErrorMessage('')
        setDashboard(initialDashboardState)
      }
    },
    [resetRuntimeData, stopMediaStream],
  )

  const ensureFaceLandmarker = useCallback(async () => {
    if (faceLandmarkerRef.current) {
      return faceLandmarkerRef.current
    }

    const vision = await FilesetResolver.forVisionTasks(WASM_URL)
    const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    })

    faceLandmarkerRef.current = faceLandmarker
    return faceLandmarker
  }, [])

  useEffect(() => {
    thresholdRef.current = threshold
    window.localStorage.setItem(STORAGE_KEY, String(threshold))
  }, [threshold])

  useEffect(() => {
    return () => {
      stopMonitoring(false)
      faceLandmarkerRef.current?.close()
      faceLandmarkerRef.current = null
    }
  }, [stopMonitoring])

  const startMonitoring = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Текущий браузер не поддерживает доступ к веб-камере.')
      setDashboard((currentState) => ({ ...currentState, status: 'error' }))
      return
    }

    stopMonitoring(false)
    setErrorMessage('')
    setIsMonitoring(true)
    setDashboard({ ...initialDashboardState, status: 'starting' })

    try {
      const permissionState = await getCameraPermissionState()
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoInputCount = devices.filter((device) => device.kind === 'videoinput').length

      if (permissionState === 'denied') {
        throw new Error(
          'Доступ к веб-камере уже заблокирован в браузере. Разрешите камеру для этого сайта и обновите страницу.',
        )
      }

      if (videoInputCount === 0) {
        throw new Error(
          'Браузер не обнаружил доступную камеру. Проверьте устройство и системные разрешения Windows.',
        )
      }

      const stream = await requestCameraStream()

      streamRef.current = stream

      const video = videoRef.current

      if (!video) {
        throw new Error('Видеоэлемент не найден.')
      }

      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await waitForVideoReady(video)
      await video.play()
      syncCanvasWithVideo()
      const faceLandmarker = await ensureFaceLandmarker()
      const startedAt = performance.now()

      sessionStartedAtRef.current = startedAt
      lastFrameTimestampRef.current = startedAt
      lastFaceSeenAtRef.current = startedAt

      const processFrame = () => {
        const activeVideo = videoRef.current

        if (!activeVideo || !sessionStartedAtRef.current) {
          return
        }

        animationFrameRef.current = requestAnimationFrame(processFrame)

        if (activeVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          return
        }

        if (activeVideo.currentTime === lastVideoTimeRef.current) {
          return
        }

        lastVideoTimeRef.current = activeVideo.currentTime
        syncCanvasWithVideo()

        const nowMs = performance.now()
        const frameDeltaMs = nowMs - (lastFrameTimestampRef.current ?? nowMs)
        lastFrameTimestampRef.current = nowMs

        const result = faceLandmarker.detectForVideo(activeVideo, nowMs)
        const landmarks = result.faceLandmarks[0]
        const hasFace = Boolean(landmarks)

        drawOverlay(canvasRef.current, result, hasFace)

        if (hasFace) {
          lastFaceSeenAtRef.current = nowMs
        }

        if (!hasFace) {
          if (
            lastFaceSeenAtRef.current !== null &&
            nowMs - lastFaceSeenAtRef.current > FACE_TIMEOUT_MS
          ) {
            eyeClosedRef.current = false
            closedStartedAtRef.current = null

            if (nowMs - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
              lastUiUpdateRef.current = nowMs
              setDashboard((currentState) => ({
                ...currentState,
                status: 'face-missing',
                hasFace: false,
                sessionDurationMs: nowMs - (sessionStartedAtRef.current ?? nowMs),
              }))
            }
          }

          return
        }

        const currentEar = calculateAverageEar(landmarks as NormalizedLandmark[])

        if (eyeClosedRef.current) {
          totalClosedEyeMsRef.current += frameDeltaMs
        }

        if (!eyeClosedRef.current && currentEar < EYE_CLOSED_THRESHOLD) {
          eyeClosedRef.current = true
          closedStartedAtRef.current = nowMs
        } else if (eyeClosedRef.current && currentEar > EYE_OPEN_THRESHOLD) {
          const blinkDurationMs = nowMs - (closedStartedAtRef.current ?? nowMs)

          eyeClosedRef.current = false
          closedStartedAtRef.current = null

          if (
            blinkDurationMs >= MIN_BLINK_DURATION_MS &&
            blinkDurationMs <= MAX_BLINK_DURATION_MS
          ) {
            blinkCountRef.current += 1
            blinkEventsRef.current = [
              ...blinkEventsRef.current,
              { timestampMs: nowMs, durationMs: blinkDurationMs },
            ].filter((blink) => nowMs - blink.timestampMs < 5 * 60_000)
          }
        }

        const sessionDurationMs = nowMs - sessionStartedAtRef.current
        const fatigueMetrics = buildFatigueMetrics({
          blinkEvents: blinkEventsRef.current,
          sessionDurationMs,
          totalClosedEyeMs: totalClosedEyeMsRef.current,
          nowMs,
        })

        const nextStatus = resolveMonitoringStatus(
          fatigueMetrics.fatigueScore,
          thresholdRef.current,
          fatigueMetrics.blinkRatePerMinute,
        )

        if (nowMs - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
          lastUiUpdateRef.current = nowMs
          setDashboard({
            status: nextStatus,
            blinkCount: blinkCountRef.current,
            currentEar,
            sessionDurationMs,
            hasFace: true,
            fatigueMetrics,
          })
        }
      }

      animationFrameRef.current = requestAnimationFrame(processFrame)
    } catch (error) {
      const permissionState = await getCameraPermissionState()
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
      const videoInputCount = devices.filter((device) => device.kind === 'videoinput').length

      stopMonitoring(false)
      setIsMonitoring(false)
      setErrorMessage(getCameraErrorMessage(error, permissionState, videoInputCount))
      setDashboard((currentState) => ({ ...currentState, status: 'error' }))
    }
  }, [ensureFaceLandmarker, stopMonitoring, syncCanvasWithVideo])

  const handleThresholdChange = (value: number) => {
    const nextValue = clampThreshold(value)
    setThreshold(nextValue)
    setThresholdInput(String(nextValue))
    setThresholdError('')
  }

  const handleThresholdInputChange = (rawValue: string) => {
    setThresholdInput(rawValue)
    if (thresholdError) {
      setThresholdError('')
    }
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
      description="Приложение получает поток с веб-камеры, отслеживает лицо и область глаз, фиксирует моргания и предупреждает пользователя о необходимости отдыха."
      actions={
        <div className="hero-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void startMonitoring()}
            disabled={isMonitoring}
          >
            {isMonitoring ? 'Мониторинг запущен' : APP_LABELS.startMonitoringButton}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => stopMonitoring()}
            disabled={!isMonitoring}
          >
            Остановить
          </button>
        </div>
      }
    >
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
            <p>
              Значение хранится в `localStorage` и используется для определения момента вывода
              предупреждения.
            </p>

            <div className="threshold-control">
              <input
                type="range"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step="1"
                value={threshold}
                onChange={(event) => handleThresholdChange(Number(event.target.value))}
              />
              <input
                type="number"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                value={thresholdInput}
                onChange={(event) => handleThresholdInputChange(event.target.value)}
                onBlur={handleThresholdInputBlur}
                aria-invalid={Boolean(thresholdError)}
              />
            </div>

            {thresholdError ? (
              <p className="field-error threshold-error" role="alert">
                {thresholdError}
              </p>
            ) : null}

            <div className="threshold-hint">
              Допустимый диапазон: {THRESHOLD_MIN}–{THRESHOLD_MAX}. Текущее пороговое значение:{' '}
              <strong>{threshold}</strong>
            </div>
          </article>

          <article
            className={
              dashboard.status === 'warning' ? 'warning-card warning-card-active' : 'warning-card'
            }
          >
            <h2>{APP_LABELS.userStateTitle}</h2>
            <p className={dashboard.status === 'warning' ? 'warning-text' : ''}>
              {getUserStateText(dashboard.status)}
            </p>
            {dashboard.status === 'error' && errorMessage ? (
              <p className="error-text">{errorMessage}</p>
            ) : null}
          </article>
        </aside>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>{APP_LABELS.blinkCountTitle}</span>
          <strong>{dashboard.blinkCount}</strong>
        </article>
        <article className="metric-card">
          <span>Длительность сеанса</span>
          <strong>{formatSessionDuration(dashboard.sessionDurationMs)}</strong>
        </article>
        <article className="metric-card">
          <span>{APP_LABELS.blinkRateTitle}</span>
          <strong>{dashboard.fatigueMetrics.blinkRatePerMinute} / мин</strong>
        </article>
        <article className="metric-card">
          <span>{APP_LABELS.averageBlinkDurationTitle}</span>
          <strong>{Math.round(dashboard.fatigueMetrics.averageBlinkDurationMs)} мс</strong>
        </article>
        <article className="metric-card">
          <span>Доля времени с закрытыми глазами</span>
          <strong>{(dashboard.fatigueMetrics.eyeClosureRatio * 100).toFixed(1)}%</strong>
        </article>
        <article className="metric-card accent-card">
          <span>{APP_LABELS.fatigueLevelTitle}</span>
          <strong>{dashboard.fatigueMetrics.fatigueScore} / 100</strong>
        </article>
      </section>
    </AppLayout>
  )
}
