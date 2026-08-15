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
import { resolveMonitoringStatus, type MonitoringUiStatus } from '../lib/appLabels'
import { clampThreshold } from '../lib/formValidation'
import {
  anglesFromTransformationMatrix, awayDelayMs, isLookingAway, loadCalibration, loadSensitivity,
  smoothAngles, type AttentionStatus, type CalibrationProfile, type HeadAngles, type Sensitivity,
} from '../lib/presenceMonitoring'

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
const FACE_TIMEOUT_MS = 1500

export type DashboardState = {
  status: MonitoringUiStatus
  processedFrameCount: number
  blinkCount: number
  currentEar: number
  sessionDurationMs: number
  hasFace: boolean
  attentionStatus: AttentionStatus
  fatigueMetrics: FatigueMetrics
}

type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

const emptyMetrics: FatigueMetrics = {
  blinkRatePerMinute: 0,
  averageBlinkDurationMs: 0,
  eyeClosureRatio: 0,
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
  fatigueMetrics: emptyMetrics,
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
  const blinkEventsRef = useRef<BlinkEvent[]>([])
  const blinkCountRef = useRef(0)
  const processedFrameCountRef = useRef(0)
  const smoothedAnglesRef = useRef<HeadAngles | null>(null)
  const awayStartedAtRef = useRef<number | null>(null)
  const calibrationSamplesRef = useRef<HeadAngles[]>([])
  const calibrationStartedAtRef = useRef<number | null>(null)
  const calibrationRef = useRef<CalibrationProfile | null>(loadCalibration())
  const sensitivityRef = useRef<Sensitivity>(loadSensitivity())
  const isCalibratingRef = useRef(false)
  const isPausedRef = useRef(false)

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
    blinkEventsRef.current = []
    blinkCountRef.current = 0
    processedFrameCountRef.current = 0
    smoothedAnglesRef.current = null
    awayStartedAtRef.current = null
    calibrationSamplesRef.current = []
    calibrationStartedAtRef.current = null
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
        updateDashboard(initialDashboardState)
      }
    },
    [resetRuntimeData, stopMediaStream, updateDashboard],
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
      stopMonitoring(false)
      faceLandmarkerRef.current?.close()
      faceLandmarkerRef.current = null
    }
  }, [stopMonitoring])

  const startMonitoring = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Текущий браузер не поддерживает доступ к веб-камере.')
      updateDashboard({ ...initialDashboardState, status: 'error' })
      return
    }

    stopMonitoring(false)
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
          if (isCalibratingRef.current) {
            calibrationSamplesRef.current = []
            calibrationStartedAtRef.current = null
            setCalibrationProgress(0)
            setCalibrationMessage('Лицо не видно. Посмотрите в камеру, чтобы продолжить калибровку.')
          }
          if (
            lastFaceSeenAtRef.current !== null &&
            nowMs - lastFaceSeenAtRef.current > FACE_TIMEOUT_MS
          ) {
            eyeClosedRef.current = false
            closedStartedAtRef.current = null

            if (nowMs - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
              lastUiUpdateRef.current = nowMs
              updateDashboard({
                status: 'face-missing',
                processedFrameCount: processedFrameCountRef.current,
                blinkCount: blinkCountRef.current,
                currentEar: 0,
                sessionDurationMs: nowMs - (sessionStartedAtRef.current ?? nowMs),
                hasFace: false,
                attentionStatus: isPausedRef.current ? 'paused' : 'uncertain',
                fatigueMetrics: buildFatigueMetrics({
                  blinkEvents: blinkEventsRef.current,
                  sessionDurationMs: nowMs - (sessionStartedAtRef.current ?? nowMs),
                  totalClosedEyeMs: totalClosedEyeMsRef.current,
                  nowMs,
                }),
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
          updateDashboard({
            status: nextStatus,
            processedFrameCount: processedFrameCountRef.current,
            blinkCount: blinkCountRef.current,
            currentEar,
            sessionDurationMs,
            hasFace: true,
            attentionStatus,
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
  }
}
