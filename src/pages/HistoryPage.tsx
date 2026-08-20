import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '../components/AppLayout'
import { useAuth } from '../context/AuthContext'
import { formatSessionDuration } from '../lib/eyeMetrics'
import {
  clearCompletedWorkSessions,
  loadCompletedWorkSessions,
  loadLegacyWorkSessions,
  mergeWorkSessionHistories,
  ownerIdForUser,
  type CompletedWorkSession,
} from '../lib/workSessions'
import { formatTaskDuration, loadWorkTasks, type WorkTask } from '../lib/workTasks'

const weekdayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function localDateKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function calendarCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function modeLabel(mode: CompletedWorkSession['mode']) {
  return mode === 'free' ? 'Свободная' : mode === 'pomodoro' ? 'Pomodoro' : 'Умный Pomodoro'
}

export function HistoryPage() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const ownerId = ownerIdForUser(currentUser?.id ?? 0)
  const [sessions, setSessions] = useState<CompletedWorkSession[]>([])
  const [tasks, setTasks] = useState<WorkTask[]>([])
  const [month, setMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()))
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const [personal, legacy] = await Promise.all([loadCompletedWorkSessions(ownerId), loadLegacyWorkSessions()])
      const combined = mergeWorkSessionHistories(personal, legacy)
      setSessions(combined)
      setTasks(loadWorkTasks(ownerId))
      if (combined.length > 0) {
        const latest = new Date(combined[0].completedAt)
        setSelectedDate(localDateKey(latest))
        setMonth(new Date(latest.getFullYear(), latest.getMonth(), 1))
      }
    } catch {
      setError('Не удалось открыть локальную историю сессий.')
    } finally {
      setIsLoading(false)
    }
  }, [ownerId])

  useEffect(() => { void loadHistory() }, [loadHistory])

  const grouped = useMemo(() => sessions.reduce<Record<string, CompletedWorkSession[]>>((result, session) => {
    const key = localDateKey(session.completedAt)
    ;(result[key] ??= []).push(session)
    return result
  }, {}), [sessions])
  const selectedSessions = useMemo(() => grouped[selectedDate] ?? [], [grouped, selectedDate])
  const selectedTaskTime = useMemo(() => selectedSessions.reduce<Record<string, number>>((result, session) => {
    if (session.taskId) result[session.taskId] = (result[session.taskId] ?? 0) + session.activeDurationMs
    return result
  }, {}), [selectedSessions])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const cells = calendarCells(month)

  const moveMonth = (offset: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  const clearHistory = async () => {
    if (!window.confirm('Удалить всю историю, включая старые сессии этого устройства? Восстановить её не получится.')) return
    try {
      await Promise.all([clearCompletedWorkSessions(ownerId), clearCompletedWorkSessions('legacy')])
      setSessions([])
    } catch {
      setError('Не удалось очистить историю. Попробуйте ещё раз.')
    }
  }

  return <AppLayout title="История сессий" description="Календарь рабочего ритма и сохранённые итоги." variant="wellness">
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <section className="history-intro"><span>Личная статистика</span><h1>История сессий</h1><p>Выберите день, чтобы вспомнить рабочий ритм и открыть подробный итог.</p></section>
    <section className="history-layout">
      <article className="history-calendar-card">
        <div className="calendar-toolbar"><button type="button" onClick={() => moveMonth(-1)} aria-label="Предыдущий месяц">←</button><h2>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(month)}</h2><button type="button" onClick={() => moveMonth(1)} aria-label="Следующий месяц">→</button></div>
        <div className="calendar-weekdays">{weekdayNames.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">{cells.map((date) => {
          const key = localDateKey(date)
          const daySessions = grouped[key] ?? []
          const isOutside = date.getMonth() !== month.getMonth()
          const activeMs = daySessions.reduce((sum, session) => sum + session.activeDurationMs, 0)
          return <button key={key} type="button" className={`${isOutside ? 'outside ' : ''}${selectedDate === key ? 'selected ' : ''}${daySessions.length ? 'has-sessions' : ''}`} onClick={() => setSelectedDate(key)} aria-pressed={selectedDate === key}><strong>{date.getDate()}</strong>{daySessions.length ? <><span>{daySessions.length} сесс.</span><small>{Math.round(activeMs / 60_000)} мин</small></> : null}</button>
        })}</div>
      </article>

      <aside className="history-day-card">
        <div className="summary-section-heading"><div><span>Выбранный день</span><h2>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${selectedDate}T12:00:00`))}</h2></div></div>
        {Object.keys(selectedTaskTime).length > 0 ? <div className="history-task-totals"><span>Время по задачам</span>{Object.entries(selectedTaskTime).map(([taskId, durationMs]) => { const task = taskById.get(taskId); return <div key={taskId}><i style={{ backgroundColor: task?.color ?? '#789086' }} /><strong>{task?.title ?? 'Удалённая задача'}</strong><span>{formatTaskDuration(durationMs)}</span></div> })}</div> : null}
        {isLoading ? <p className="empty-copy">Загружаем историю…</p> : selectedSessions.length === 0 ? <p className="empty-copy">В этот день завершённых сессий нет.</p> : <div className="history-session-list">{selectedSessions.map((session) => <button type="button" key={session.id} onClick={() => navigate(`/history/${session.id}`)}><span><strong>{new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.completedAt))}</strong><small>{modeLabel(session.mode)}{session.goal ? ` · ${session.goal}` : ''}</small></span><span className="history-list-score">{session.score.total ?? '—'} / 100<small>{formatSessionDuration(session.activeDurationMs)} активно</small></span></button>)}</div>}
      </aside>
    </section>

    <div className="history-footer-actions"><button type="button" className="secondary-button session-delete-button" onClick={() => void clearHistory()} disabled={sessions.length === 0}>Очистить мою историю</button></div>

  </AppLayout>
}
