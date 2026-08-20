export const COMPLETED_SESSIONS_STORAGE_KEY = 'eyeguard-completed-work-sessions'

const DATABASE_NAME = 'eyeguard-history'
const DATABASE_VERSION = 1
const SESSION_STORE = 'sessions'
const META_STORE = 'meta'
const LEGACY_MIGRATION_KEY = 'legacy-local-storage-v1'
const MAX_SESSIONS_PER_OWNER = 1000

export type SessionMode = 'free' | 'pomodoro' | 'smart-pomodoro'
export type TimelineSegmentType =
  | 'active'
  | 'away'
  | 'manual-pause'
  | 'pomodoro-break'
  | 'untracked'

export type TimelineSegment = {
  type: TimelineSegmentType
  startOffsetMs: number
  endOffsetMs: number
  reason?: 'looking-away' | 'face-missing' | 'user-paused' | 'scheduled-break' | 'camera-uncertain'
}

export type SessionScore = {
  total: number | null
  presencePoints: number | null
  stabilityPoints: number | null
  eyePoints: number | null
  activeRatio: number | null
  normalizedAwayEvents: number
  averageFatigueScore: number | null
  measurementCoverage: number
}

export type EyeSummaryState = 'comfortable' | 'strained' | 'rest-recommended' | 'insufficient-data'

export type CompletedWorkSession = {
  schemaVersion: 2
  id: string
  ownerId: string
  startedAt: string
  completedAt: string
  taskId?: string
  goal: string
  mode: SessionMode
  plannedDurationMinutes: number
  breakDurationMinutes: number
  totalDurationMs: number
  activeDurationMs: number
  awayDurationMs: number
  manualPauseDurationMs: number
  pomodoroBreakDurationMs: number
  untrackedDurationMs: number
  awayEventCount: number
  eyeTrackedDurationMs: number
  eyeWarningDurationMs: number
  score: SessionScore
  eyeState: EyeSummaryState
  summaryLabel: string
  summaryReason: string
  recommendation: string
  timeline: TimelineSegment[]
  legacy?: boolean
}

type LegacySession = Partial<CompletedWorkSession> & {
  id: string
  completedAt: string
  totalDurationMs: number
  activeDurationMs: number
  awayDurationMs: number
  manualPauseDurationMs: number
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Ошибка IndexedDB'))
  })
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка IndexedDB'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Операция IndexedDB отменена'))
  })
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('История недоступна в этом браузере.'))
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const sessions = database.createObjectStore(SESSION_STORE, { keyPath: 'id' })
      sessions.createIndex('ownerId', 'ownerId', { unique: false })
      sessions.createIndex('completedAt', 'completedAt', { unique: false })
      database.createObjectStore(META_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть историю.'))
  })
}

export function migrateLegacySession(session: LegacySession): CompletedWorkSession {
  const completedTime = new Date(session.completedAt).getTime()
  const startedAt = new Date(completedTime - Math.max(0, session.totalDurationMs)).toISOString()

  return {
    schemaVersion: 2,
    id: session.id,
    ownerId: 'legacy',
    startedAt,
    completedAt: session.completedAt,
    taskId: session.taskId,
    goal: session.goal ?? '',
    mode: session.mode ?? 'free',
    plannedDurationMinutes: session.plannedDurationMinutes ?? 0,
    breakDurationMinutes: session.breakDurationMinutes ?? 0,
    totalDurationMs: session.totalDurationMs,
    activeDurationMs: session.activeDurationMs,
    awayDurationMs: session.awayDurationMs,
    manualPauseDurationMs: session.manualPauseDurationMs,
    pomodoroBreakDurationMs: 0,
    untrackedDurationMs: Math.max(0, session.totalDurationMs - session.activeDurationMs - session.awayDurationMs - session.manualPauseDurationMs),
    awayEventCount: 0,
    eyeTrackedDurationMs: 0,
    eyeWarningDurationMs: 0,
    score: { total: null, presencePoints: null, stabilityPoints: null, eyePoints: null, activeRatio: null, normalizedAwayEvents: 0, averageFatigueScore: null, measurementCoverage: 0 },
    eyeState: 'insufficient-data',
    summaryLabel: 'Сохранённая сессия',
    summaryReason: 'Для этой записи доступна только базовая статистика.',
    recommendation: 'Начните новую сессию, чтобы получить подробный итог и таймлайн.',
    timeline: [],
    legacy: true,
  }
}

async function ensureLegacyMigration(database: IDBDatabase) {
  const readTransaction = database.transaction(META_STORE, 'readonly')
  const migrated = await requestToPromise(readTransaction.objectStore(META_STORE).get(LEGACY_MIGRATION_KEY))
  if (migrated) return

  let legacySessions: LegacySession[] = []
  try {
    const raw = window.localStorage.getItem(COMPLETED_SESSIONS_STORAGE_KEY)
    legacySessions = raw ? (JSON.parse(raw) as LegacySession[]) : []
  } catch {
    legacySessions = []
  }

  const transaction = database.transaction([SESSION_STORE, META_STORE], 'readwrite')
  const store = transaction.objectStore(SESSION_STORE)
  legacySessions.forEach((session) => store.put(migrateLegacySession(session)))
  transaction.objectStore(META_STORE).put({ key: LEGACY_MIGRATION_KEY, migratedAt: new Date().toISOString() })
  await transactionToPromise(transaction)
}

async function withDatabase<T>(operation: (database: IDBDatabase) => Promise<T>) {
  const database = await openDatabase()
  try {
    await ensureLegacyMigration(database)
    return await operation(database)
  } finally {
    database.close()
  }
}

export async function saveCompletedWorkSession(session: CompletedWorkSession) {
  await withDatabase(async (database) => {
    const write = database.transaction(SESSION_STORE, 'readwrite')
    write.objectStore(SESSION_STORE).put(session)
    await transactionToPromise(write)

    const read = database.transaction(SESSION_STORE, 'readonly')
    const ownerSessions = await requestToPromise(read.objectStore(SESSION_STORE).index('ownerId').getAll(session.ownerId)) as CompletedWorkSession[]
    const stale = sessionsBeyondRetention(ownerSessions)
    if (stale.length > 0) {
      const cleanup = database.transaction(SESSION_STORE, 'readwrite')
      stale.forEach((item) => cleanup.objectStore(SESSION_STORE).delete(item.id))
      await transactionToPromise(cleanup)
    }
  })
}

export function sessionsBeyondRetention(sessions: CompletedWorkSession[]) {
  return [...sessions]
    .sort((first, second) => second.completedAt.localeCompare(first.completedAt))
    .slice(MAX_SESSIONS_PER_OWNER)
}

export function mergeWorkSessionHistories(...groups: CompletedWorkSession[][]) {
  const byId = new Map<string, CompletedWorkSession>()
  groups.flat().forEach((session) => byId.set(session.id, session))
  return [...byId.values()].sort((first, second) => second.completedAt.localeCompare(first.completedAt))
}

export async function loadCompletedWorkSessions(ownerId: string) {
  return withDatabase(async (database) => {
    const transaction = database.transaction(SESSION_STORE, 'readonly')
    const sessions = await requestToPromise(transaction.objectStore(SESSION_STORE).index('ownerId').getAll(ownerId)) as CompletedWorkSession[]
    return sessions.sort((first, second) => second.completedAt.localeCompare(first.completedAt))
  })
}

export async function loadLegacyWorkSessions() {
  return loadCompletedWorkSessions('legacy')
}

export async function loadCompletedWorkSession(id: string) {
  return withDatabase(async (database) => {
    const transaction = database.transaction(SESSION_STORE, 'readonly')
    return (await requestToPromise(transaction.objectStore(SESSION_STORE).get(id))) as CompletedWorkSession | undefined
  })
}

export async function deleteCompletedWorkSession(id: string) {
  return withDatabase(async (database) => {
    const transaction = database.transaction(SESSION_STORE, 'readwrite')
    transaction.objectStore(SESSION_STORE).delete(id)
    await transactionToPromise(transaction)
  })
}

export async function clearCompletedWorkSessions(ownerId: string) {
  return withDatabase(async (database) => {
    const read = database.transaction(SESSION_STORE, 'readonly')
    const sessions = await requestToPromise(read.objectStore(SESSION_STORE).index('ownerId').getAll(ownerId)) as CompletedWorkSession[]
    const write = database.transaction(SESSION_STORE, 'readwrite')
    sessions.forEach((session) => write.objectStore(SESSION_STORE).delete(session.id))
    await transactionToPromise(write)
  })
}

export function ownerIdForUser(userId: number) {
  return userId === 0 ? 'guest' : `user:${userId}`
}
