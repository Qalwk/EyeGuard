import { useCallback, useEffect, useRef, useState } from 'react'
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
  type BlinkEvent,
  type FatigueMetrics,
} from '../lib/eyeMetrics'
import { type MonitoringUiStatus } from '../lib/appLabels'
import {
  buildEyeStrainAssessment,
  initialEyeStrainAssessment,
  type EyeStrainAssessment,
} from '../lib/eyeStrain'
import { clampThreshold } from '../lib/formValidation'
import {
  anglesFromTransformationMatrix, awayDelayMs, isLookingAway, loadCalibration, loadSensitivity,
  smoothAngles, type AttentionStatus, type CalibrationProfile, type HeadAngles, type Sensitivity,
} from '../lib/presenceMonitoring'
import { appendTimelineSegment, buildCompletedWorkSession, replaceTimelineTail } from '../lib/sessionSummary'
import {
  saveCompletedWorkSession,
  type CompletedWorkSession,
  type TimelineSegment,
  type TimelineSegmentType,
} from '../lib/workSessions'

export const THRESHOLD_STORAGE_KEY = 'eyeguard-fatigue-threshold'
const DEFAULT_THRESHOLD = 55
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const EYE_CLOSED_THRESHOLD = 0.21
const EYE_OPEN_THRESHOLD = 0.24
const MIN_BLINK_DURATION_MS = 60
const MAX_BLINK_DURATION_MS = 1200
const UI_UPDATE_INTERVAL_MS = 180
const FACE_TIMEOUT_MS = 5000

export type DashboardState = {
  status: MonitoringUiStatus
  processedFrameCount: number
  blinkCount: number
  currentEar: number
  sessionDurationMs: number
  hasFace: boolean
  attentionStatus: AttentionStatus
  activeSessionDurationMs: number
  awayDurationMs: number
  manualPauseDurationMs: number
  pomodoroBreakDurationMs: number
  untrackedDurationMs: number
  continuousFocusDurationMs: number
  fatigueMetrics: FatigueMetrics
  eyeStrainAssessment: EyeStrainAssessment
}

type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

const emptyMetrics: FatigueMetrics = {
  blinkRatePerMinute: 0,
  estimatedBlinkRatePerMinute: 0,
  averageBlinkDurationMs: 0,
  eyeClosureRatio: 0,
  incompleteBlinkRatio: 0,
  characterizedBlinkCount: 0,
  longBlinkRatio: 0,
  observationDurationMs: 0,
  fatigueScore: 0,
}

export const initialDashboardState: DashboardState = {
  status: 'idle',
  processedFrameCount: 0,
  blinkCount: 0,
  currentEar: 0,
  sessionDurationMs: 0,
  hasFace: false,
  attentionStatus: 'uncertain',
  activeSessionDurationMs: 0,
  awayDurationMs: 0,
  manualPauseDurationMs: 0,
  pomodoroBreakDurationMs: 0,
  untrackedDurationMs: 0,
  continuousFocusDurationMs: 0,
  fatigueMetrics: emptyMetrics,
  eyeStrainAssessment: initialEyeStrainAssessment,
}

export function loadStoredThreshold() {
  const storedValue = window.localStorage.getItem(THRESHOLD_STORAGE_KEY)
  const parsedValue = Number(storedValue)

  if (!storedValue || Number.isNaN(parsedValue)) {
    return DEFAULT_THRESHOLD
  }

  return clampThreshold(parsedValue)
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

type UseEyeMonitoringOptions = {
  autoStart?: boolean
  onDashboardUpdate?: (state: DashboardState) => void
}

export type WorkSessionSetup = {
  mode?: 'free' | 'pomodoro' | 'smart-pomodoro'
  taskId?: string
  plannedDurationMinutes?: number
  breakDurationMinutes?: number
  goal?: string
  ownerId?: string
}

export function useEyeMonitoring(options: UseEyeMonitoringOptions = {}) {
  const { autoStart = false, onDashboardUpdate } = options
  const onDashboardUpdateRef = useRef(onDashboardUpdate)

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
  const openEarBaselineRef = useRef<number | null>(null)
  const blinkMinimumEarRef = useRef<number | null>(null)
  const blinkOpenEarRef = useRef<number | null>(null)
  const blinkEventsRef = useRef<BlinkEvent[]>([])
  const blinkCountRef = useRef(0)
  const processedFrameCountRef = useRef(0)
  const smoothedAnglesRef = useRef<HeadAngles | null>(null)
  const awayStartedAtRef = useRef<number | null>(null)
  const missingFaceStartedAtRef = useRef<number | null>(null)
  const missingFaceConvertedRef = useRef(false)
  const missingUntrackedMsRef = useRef(0)
  const stateBeforeMissingRef = useRef<TimelineSegmentType>('untracked')
  const calibrationSamplesRef = useRef<HeadAngles[]>([])
  const calibrationStartedAtRef = useRef<number | null>(null)
  const calibrationRef = useRef<CalibrationProfile | null>(loadCalibration())
  const sensitivityRef = useRef<Sensitivity>(loadSensitivity())
  const isCalibratingRef = useRef(false)
  const isPausedRef = useRef(false)
  const sessionSetupRef = useRef<WorkSessionSetup | null>(null)
  const sessionPhaseRef = useRef<'focus' | 'break'>('focus')
  const sessionTimesRef = useRef({ activeMs: 0, awayMs: 0, manualPauseMs: 0, breakMs: 0, untrackedMs: 0 })
  const timelineRef = useRef<TimelineSegment[]>([])
  const fatigueScoreIntegralRef = useRef(0)
  const eyeTrackedDurationMsRef = useRef(0)
  const eyeWarningDurationMsRef = useRef(0)
  const continuousFocusMsRef = useRef(0)
  const recoveryBreakMsRef = useRef(0)
  const blinkBaselineRef = useRef<number | null>(null)

  const [threshold, setThreshold] = useState(() => loadStoredThreshold())
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [dashboard, setDashboard] = useState<DashboardState>(initialDashboardState)
  const [sensitivity, setSensitivity] = useState<Sensitivity>(() => loadSensitivity())
  const [calibration, setCalibration] = useState<CalibrationProfile | null>(() => loadCalibration())
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [calibrationProgress, setCalibrationProgress] = useState(0)
  const [calibrationMessage, setCalibrationMessage] = useState('')
  const [isPaused, setIsPaused] = useState(false)
  const [completedSession, setCompletedSession] = useState<CompletedWorkSession | null>(null)
  const [sessionSaveError, setSessionSaveError] = useState('')

  useEffect(() => {
    onDashboardUpdateRef.current = onDashboardUpdate
  }, [onDashboardUpdate])

  const updateDashboard = useCallback((nextState: DashboardState) => {
    setDashboard(nextState)
    onDashboardUpdateRef.current?.(nextState)
  }, [])

  const resetRuntimeData = useCallback(() => {
    sessionStartedAtRef.current = null
    lastVideoTimeRef.current = -1
    lastFrameTimestampRef.current = null
    lastUiUpdateRef.current = 0
    lastFaceSeenAtRef.current = null
    eyeClosedRef.current = false
    closedStartedAtRef.current = null
    totalClosedEyeMsRef.current = 0
    openEarBaselineRef.current = null
    blinkMinimumEarRef.current = null
    blinkOpenEarRef.current = null
    blinkEventsRef.current = []
    blinkCountRef.current = 0
    processedFrameCountRef.current = 0
    smoothedAnglesRef.current = null
    awayStartedAtRef.current = null
    missingFaceStartedAtRef.current = null
    missingFaceConvertedRef.current = false
    missingUntrackedMsRef.current = 0
    stateBeforeMissingRef.current = 'untracked'
    calibrationSamplesRef.current = []
    calibrationStartedAtRef.current = null
    sessionPhaseRef.current = 'focus'
    sessionTimesRef.current = { activeMs: 0, awayMs: 0, manualPauseMs: 0, breakMs: 0, untrackedMs: 0 }
    timelineRef.current = []
    fatigueScoreIntegralRef.current = 0
    eyeTrackedDurationMsRef.current = 0
    eyeWarningDurationMsRef.current = 0
    continuousFocusMsRef.current = 0
    recoveryBreakMsRef.current = 0
    blinkBaselineRef.current = null
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
    async (saveSession = true) => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      const startedAt = sessionStartedAtRef.current
      const setup = sessionSetupRef.current
      let result: CompletedWorkSession | null = null
      if (saveSession && startedAt && setup) {
        const completedAt = new Date()
        const totalDurationMs = performance.now() - startedAt
        result = buildCompletedWorkSession({
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          ownerId: setup.ownerId ?? 'guest',
          startedAt: new Date(completedAt.getTime() - totalDurationMs).toISOString(),
          completedAt: completedAt.toISOString(),
          taskId: setup.taskId,
          goal: setup.goal?.trim() ?? '',
          mode: setup.mode ?? 'free',
          plannedDurationMinutes: setup.plannedDurationMinutes ?? 0,
          breakDurationMinutes: setup.breakDurationMinutes ?? 0,
          totalDurationMs,
          timeline: [...timelineRef.current],
          fatigueScoreIntegral: fatigueScoreIntegralRef.current,
          eyeTrackedDurationMs: eyeTrackedDurationMsRef.current,
          eyeWarningDurationMs: eyeWarningDurationMsRef.current,
        })
      }
      stopMediaStream()
      resetRuntimeData()
      sessionSetupRef.current = null
      drawOverlay(canvasRef.current, null, false)

      if (saveSession) {
        setIsMonitoring(false)
        setErrorMessage('')
        updateDashboard(initialDashboardState)
      }
      if (result) {
        setSessionSaveError('')
        try {
          await saveCompletedWorkSession(result)
          setCompletedSession(result)
        } catch {
          setCompletedSession(result)
          setSessionSaveError('Не удалось сохранить итог в историю. Результат не потерян - попробуйте ещё раз.')
        }
      }
      return result
    },
    [resetRuntimeData, stopMediaStream, updateDashboard],
  )

  const retryCompletedSessionSave = useCallback(async () => {
    if (!completedSession) return
    try {
      await saveCompletedWorkSession(completedSession)
      setSessionSaveError('')
    } catch {
      setSessionSaveError('История пока недоступна. Проверьте настройки хранения данных браузера и повторите попытку.')
    }
  }, [completedSession])

  const clearCompletedSession = useCallback(() => {
    setCompletedSession(null)
    setSessionSaveError('')
  }, [])

  const setSessionPhase = useCallback((phase: 'focus' | 'break') => {
    sessionPhaseRef.current = phase
  }, [])

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
      outputFacialTransformationMatrixes: true,
    })

    faceLandmarkerRef.current = faceLandmarker
    return faceLandmarker
  }, [])

  useEffect(() => {
    thresholdRef.current = threshold
    window.localStorage.setItem(THRESHOLD_STORAGE_KEY, String(threshold))
  }, [threshold])

  useEffect(() => {
    window.localStorage.setItem('eyeguard-presence-sensitivity', sensitivity)
    sensitivityRef.current = sensitivity
  }, [sensitivity])

  useEffect(() => {
    calibrationRef.current = calibration
  }, [calibration])

  const startCalibration = useCallback(() => {
    calibrationSamplesRef.current = []
    calibrationStartedAtRef.current = null
    setCalibrationProgress(0)
    setCalibrationMessage('Смотрите на экран. Калибровка начнётся, когда камера увидит лицо.')
    isCalibratingRef.current = true
    setIsCalibrating(true)
  }, [])

  const setPaused = useCallback((paused: boolean) => {
    setIsPaused(paused)
    isPausedRef.current = paused
    awayStartedAtRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      void stopMonitoring(false)
      faceLandmarkerRef.current?.close()
      faceLandmarkerRef.current = null
    }
  }, [stopMonitoring])

  const startMonitoring = useCallback(async (setup?: WorkSessionSetup) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Текущий браузер не поддерживает доступ к веб-камере.')
      updateDashboard({ ...initialDashboardState, status: 'error' })
      return
    }

    await stopMonitoring(false)
    setCompletedSession(null)
    setSessionSaveError('')
    sessionSetupRef.current = setup ?? { mode: 'free' }
    setErrorMessage('')
    setIsMonitoring(true)
    updateDashboard({ ...initialDashboardState, status: 'starting' })

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
      isPausedRef.current = false
      setIsPaused(false)
      if (!calibrationRef.current) {
        calibrationSamplesRef.current = []
        calibrationStartedAtRef.current = null
        isCalibratingRef.current = true
        setIsCalibrating(true)
        setCalibrationProgress(0)
        setCalibrationMessage('Смотрите на экран 5 секунд, чтобы настроить обычное положение.')
      }

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
        processedFrameCountRef.current += 1
        const frameStartedAt = lastFrameTimestampRef.current ?? nowMs
        const frameDeltaMs = nowMs - frameStartedAt
        lastFrameTimestampRef.current = nowMs
        const sessionStartedAt = sessionStartedAtRef.current
        const recordInterval = (
          type: TimelineSegmentType,
          reason?: TimelineSegment['reason'],
        ) => appendTimelineSegment(
          timelineRef.current,
          type,
          Math.max(0, frameStartedAt - sessionStartedAt),
          Math.max(0, nowMs - sessionStartedAt),
          reason,
        )

        const result = faceLandmarker.detectForVideo(activeVideo, nowMs)
        const landmarks = result.faceLandmarks[0]
        const hasFace = Boolean(landmarks)

        drawOverlay(canvasRef.current, result, hasFace)

        if (hasFace) {
          lastFaceSeenAtRef.current = nowMs
          if (missingFaceStartedAtRef.current !== null && !missingFaceConvertedRef.current) {
            const fallbackType = stateBeforeMissingRef.current
            if (fallbackType === 'active' || fallbackType === 'away') {
              sessionTimesRef.current.untrackedMs = Math.max(0, sessionTimesRef.current.untrackedMs - missingUntrackedMsRef.current)
              if (fallbackType === 'active') sessionTimesRef.current.activeMs += missingUntrackedMsRef.current
              else sessionTimesRef.current.awayMs += missingUntrackedMsRef.current
              replaceTimelineTail(
                timelineRef.current,
                Math.max(0, missingFaceStartedAtRef.current - sessionStartedAt),
                fallbackType,
                Math.max(0, nowMs - sessionStartedAt),
                fallbackType === 'away' ? 'looking-away' : undefined,
              )
            }
          }
          missingFaceStartedAtRef.current = null
          missingFaceConvertedRef.current = false
          missingUntrackedMsRef.current = 0
        }

        if (!hasFace) {
          recoveryBreakMsRef.current += frameDeltaMs
          if (recoveryBreakMsRef.current >= 20_000) {
            continuousFocusMsRef.current = 0
            blinkEventsRef.current = []
            blinkBaselineRef.current = null
          }
          if (isPausedRef.current) {
            sessionTimesRef.current.manualPauseMs += frameDeltaMs
            recordInterval('manual-pause', 'user-paused')
            missingFaceStartedAtRef.current = null
            missingUntrackedMsRef.current = 0
          } else if (sessionPhaseRef.current === 'break') {
            sessionTimesRef.current.breakMs += frameDeltaMs
            recordInterval('pomodoro-break', 'scheduled-break')
            missingFaceStartedAtRef.current = null
            missingUntrackedMsRef.current = 0
          } else {
            if (missingFaceStartedAtRef.current === null) {
              missingFaceStartedAtRef.current = frameStartedAt
              missingFaceConvertedRef.current = false
              missingUntrackedMsRef.current = 0
              const previous = timelineRef.current[timelineRef.current.length - 1]
              stateBeforeMissingRef.current = previous?.type ?? 'untracked'
            }
            if (missingFaceConvertedRef.current) {
              sessionTimesRef.current.awayMs += frameDeltaMs
              recordInterval('away', 'face-missing')
            } else {
              sessionTimesRef.current.untrackedMs += frameDeltaMs
              missingUntrackedMsRef.current += frameDeltaMs
              recordInterval('untracked', 'camera-uncertain')
              if (nowMs - missingFaceStartedAtRef.current >= FACE_TIMEOUT_MS) {
                sessionTimesRef.current.untrackedMs = Math.max(0, sessionTimesRef.current.untrackedMs - missingUntrackedMsRef.current)
                sessionTimesRef.current.awayMs += missingUntrackedMsRef.current
                replaceTimelineTail(
                  timelineRef.current,
                  Math.max(0, missingFaceStartedAtRef.current - sessionStartedAt),
                  'away',
                  Math.max(0, nowMs - sessionStartedAt),
                  'face-missing',
                )
                missingFaceConvertedRef.current = true
                missingUntrackedMsRef.current = 0
              }
            }
          }
          if (isCalibratingRef.current) {
            calibrationSamplesRef.current = []
            calibrationStartedAtRef.current = null
            setCalibrationProgress(0)
            setCalibrationMessage('Лицо не видно. Посмотрите в камеру, чтобы продолжить калибровку.')
          }
          if (
            lastFaceSeenAtRef.current !== null &&
            nowMs - lastFaceSeenAtRef.current >= FACE_TIMEOUT_MS
          ) {
            eyeClosedRef.current = false
            closedStartedAtRef.current = null

            if (nowMs - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
              lastUiUpdateRef.current = nowMs
              const fatigueMetrics = buildFatigueMetrics({
                blinkEvents: blinkEventsRef.current,
                sessionDurationMs: continuousFocusMsRef.current,
                totalClosedEyeMs: totalClosedEyeMsRef.current,
                nowMs,
              })
              const eyeStrainAssessment = buildEyeStrainAssessment({
                metrics: fatigueMetrics,
                sessionDurationMs: nowMs - (sessionStartedAtRef.current ?? nowMs),
                continuousFocusMs: continuousFocusMsRef.current,
                baselineBlinkRate: blinkBaselineRef.current,
              })
              updateDashboard({
                status: 'face-missing',
                processedFrameCount: processedFrameCountRef.current,
                blinkCount: blinkCountRef.current,
                currentEar: 0,
                sessionDurationMs: nowMs - (sessionStartedAtRef.current ?? nowMs),
                hasFace: false,
                attentionStatus: isPausedRef.current ? 'paused' : 'uncertain',
                activeSessionDurationMs: sessionTimesRef.current.activeMs,
                awayDurationMs: sessionTimesRef.current.awayMs,
                manualPauseDurationMs: sessionTimesRef.current.manualPauseMs,
                pomodoroBreakDurationMs: sessionTimesRef.current.breakMs,
                untrackedDurationMs: sessionTimesRef.current.untrackedMs,
                continuousFocusDurationMs: continuousFocusMsRef.current,
                fatigueMetrics,
                eyeStrainAssessment,
              })
            }
          }

          return
        }

        const currentEar = calculateAverageEar(landmarks as NormalizedLandmark[])
        const matrixAngles = anglesFromTransformationMatrix(result.facialTransformationMatrixes[0]?.data)
        if (matrixAngles) {
          smoothedAnglesRef.current = smoothAngles(smoothedAnglesRef.current, matrixAngles)
        }

        if (isCalibratingRef.current) {
          if (!matrixAngles) {
            setCalibrationMessage('Камера не уверена в положении лица. Сядьте ровно и смотрите на экран.')
          } else {
            const calibrationStart = calibrationStartedAtRef.current ?? nowMs
            calibrationStartedAtRef.current = calibrationStart
            calibrationSamplesRef.current.push(matrixAngles)
            const elapsed = nowMs - calibrationStart
            setCalibrationProgress(Math.min(100, Math.round((elapsed / 5000) * 100)))
            setCalibrationMessage('Смотрите на экран ещё немного…')
            if (elapsed >= 5000) {
              const samples = calibrationSamplesRef.current
              const totals = samples.reduce((total, item) => ({ yaw: total.yaw + item.yaw, pitch: total.pitch + item.pitch, roll: total.roll + item.roll }), { yaw: 0, pitch: 0, roll: 0 })
              const profile = { angles: { yaw: totals.yaw / samples.length, pitch: totals.pitch / samples.length, roll: totals.roll / samples.length }, savedAt: Date.now() }
              window.localStorage.setItem('eyeguard-presence-calibration', JSON.stringify(profile))
              setCalibration(profile)
              calibrationRef.current = profile
              isCalibratingRef.current = false
              setIsCalibrating(false)
              setCalibrationProgress(100)
              setCalibrationMessage('Готово. Обычное положение сохранено на этом устройстве.')
            }
          }
        }

        const stableAngles = smoothedAnglesRef.current
        let attentionStatus: AttentionStatus = isPausedRef.current ? 'paused' : 'uncertain'
        if (!isPausedRef.current && calibrationRef.current && stableAngles) {
          if (isLookingAway(stableAngles, calibrationRef.current.angles, sensitivityRef.current)) {
            awayStartedAtRef.current ??= nowMs
            attentionStatus = nowMs - awayStartedAtRef.current >= awayDelayMs(sensitivityRef.current) ? 'away' : 'active'
          } else {
            awayStartedAtRef.current = null
            attentionStatus = 'active'
          }
        }

        let timelineType: TimelineSegmentType = 'untracked'
        let timelineReason: TimelineSegment['reason'] = 'camera-uncertain'
        if (isPausedRef.current) {
          timelineType = 'manual-pause'
          timelineReason = 'user-paused'
        } else if (sessionPhaseRef.current === 'break') {
          timelineType = 'pomodoro-break'
          timelineReason = 'scheduled-break'
        } else if (attentionStatus === 'active') {
          timelineType = 'active'
          timelineReason = undefined
        } else if (attentionStatus === 'away') {
          timelineType = 'away'
          timelineReason = 'looking-away'
        }

        if (timelineType === 'active') {
          sessionTimesRef.current.activeMs += frameDeltaMs
          continuousFocusMsRef.current += frameDeltaMs
          recoveryBreakMsRef.current = 0
        } else if (timelineType === 'away') {
          sessionTimesRef.current.awayMs += frameDeltaMs
        } else if (timelineType === 'manual-pause') {
          sessionTimesRef.current.manualPauseMs += frameDeltaMs
        } else if (timelineType === 'pomodoro-break') {
          sessionTimesRef.current.breakMs += frameDeltaMs
        } else {
          sessionTimesRef.current.untrackedMs += frameDeltaMs
        }

        if (
          timelineType === 'away' ||
          timelineType === 'manual-pause' ||
          timelineType === 'pomodoro-break'
        ) {
          recoveryBreakMsRef.current += frameDeltaMs
          if (recoveryBreakMsRef.current >= 20_000) {
            continuousFocusMsRef.current = 0
            blinkEventsRef.current = []
            blinkBaselineRef.current = null
          }
        }
        recordInterval(timelineType, timelineReason)

        if (eyeClosedRef.current) {
          totalClosedEyeMsRef.current += frameDeltaMs
          blinkMinimumEarRef.current = Math.min(
            blinkMinimumEarRef.current ?? currentEar,
            currentEar,
          )
        } else if (currentEar > EYE_OPEN_THRESHOLD) {
          openEarBaselineRef.current = openEarBaselineRef.current === null
            ? currentEar
            : openEarBaselineRef.current * 0.98 + currentEar * 0.02
        }

        if (!eyeClosedRef.current && currentEar < EYE_CLOSED_THRESHOLD) {
          eyeClosedRef.current = true
          closedStartedAtRef.current = nowMs
          blinkMinimumEarRef.current = currentEar
          blinkOpenEarRef.current = openEarBaselineRef.current
        } else if (eyeClosedRef.current && currentEar > EYE_OPEN_THRESHOLD) {
          const blinkDurationMs = nowMs - (closedStartedAtRef.current ?? nowMs)
          const openEar = blinkOpenEarRef.current
          const minimumEar = blinkMinimumEarRef.current
          const closureDepth = openEar && minimumEar !== null
            ? Math.max(0, Math.min(1, (openEar - minimumEar) / openEar))
            : undefined

          eyeClosedRef.current = false
          closedStartedAtRef.current = null
          blinkMinimumEarRef.current = null
          blinkOpenEarRef.current = null

          if (
            timelineType === 'active' &&
            blinkDurationMs >= MIN_BLINK_DURATION_MS &&
            blinkDurationMs <= MAX_BLINK_DURATION_MS
          ) {
            blinkCountRef.current += 1
            blinkEventsRef.current = [
              ...blinkEventsRef.current,
              { timestampMs: nowMs, durationMs: blinkDurationMs, closureDepth },
            ].filter((blink) => nowMs - blink.timestampMs < 5 * 60_000)
          }
        }

        const sessionDurationMs = nowMs - sessionStartedAtRef.current
        const fatigueMetrics = buildFatigueMetrics({
          blinkEvents: blinkEventsRef.current,
          sessionDurationMs: continuousFocusMsRef.current,
          totalClosedEyeMs: totalClosedEyeMsRef.current,
          nowMs,
        })

        if (
          blinkBaselineRef.current === null &&
          continuousFocusMsRef.current >= 60_000 &&
          fatigueMetrics.estimatedBlinkRatePerMinute >= 4 &&
          fatigueMetrics.estimatedBlinkRatePerMinute <= 30
        ) {
          blinkBaselineRef.current = fatigueMetrics.estimatedBlinkRatePerMinute
        }

        const eyeStrainAssessment = buildEyeStrainAssessment({
          metrics: fatigueMetrics,
          sessionDurationMs,
          continuousFocusMs: continuousFocusMsRef.current,
          baselineBlinkRate: blinkBaselineRef.current,
        })
        const nextStatus = eyeStrainAssessment.level === 'high' ? 'warning' : 'tracking'

        if (timelineType === 'active' && !eyeStrainAssessment.alertsSuppressed) {
          fatigueScoreIntegralRef.current += eyeStrainAssessment.score * frameDeltaMs
          eyeTrackedDurationMsRef.current += frameDeltaMs
          if (nextStatus === 'warning') eyeWarningDurationMsRef.current += frameDeltaMs
        }

        if (nowMs - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
          lastUiUpdateRef.current = nowMs
          updateDashboard({
            status: nextStatus,
            processedFrameCount: processedFrameCountRef.current,
            blinkCount: blinkCountRef.current,
            currentEar,
            sessionDurationMs,
            hasFace: true,
            attentionStatus,
            activeSessionDurationMs: sessionTimesRef.current.activeMs,
            awayDurationMs: sessionTimesRef.current.awayMs,
            manualPauseDurationMs: sessionTimesRef.current.manualPauseMs,
            pomodoroBreakDurationMs: sessionTimesRef.current.breakMs,
            untrackedDurationMs: sessionTimesRef.current.untrackedMs,
            continuousFocusDurationMs: continuousFocusMsRef.current,
            fatigueMetrics,
            eyeStrainAssessment,
          })
        }
      }

      animationFrameRef.current = requestAnimationFrame(processFrame)
    } catch (error) {
      const permissionState = await getCameraPermissionState()
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
      const videoInputCount = devices.filter((device) => device.kind === 'videoinput').length

      void stopMonitoring(false)
      setIsMonitoring(false)
      setErrorMessage(getCameraErrorMessage(error, permissionState, videoInputCount))
      updateDashboard({ ...initialDashboardState, status: 'error' })
    }
  }, [ensureFaceLandmarker, stopMonitoring, syncCanvasWithVideo, updateDashboard])

  useEffect(() => {
    if (autoStart) {
      void startMonitoring()
    }
  }, [autoStart, startMonitoring])

  return {
    videoRef,
    canvasRef,
    threshold,
    setThreshold,
    isMonitoring,
    errorMessage,
    dashboard,
    sensitivity,
    setSensitivity,
    calibration,
    isCalibrating,
    calibrationProgress,
    calibrationMessage,
    startCalibration,
    isPaused,
    setPaused,
    startMonitoring,
    stopMonitoring,
    setSessionPhase,
    completedSession,
    sessionSaveError,
    retryCompletedSessionSave,
    clearCompletedSession,
  }
}
