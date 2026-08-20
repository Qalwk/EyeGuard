import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '../components/AppLayout'
import { useAuth } from '../context/AuthContext'
import { loadCompletedWorkSessions, ownerIdForUser, type CompletedWorkSession } from '../lib/workSessions'
import {
  deleteWorkTask,
  formatTaskDuration,
  loadWorkTasks,
  saveWorkTask,
  TASK_COLORS,
  taskProgress,
  type WorkTask,
  type WorkTaskStatus,
} from '../lib/workTasks'

const statusLabels: Record<WorkTaskStatus, string> = {
  planned: 'Бэклог',
  'in-progress': 'Сегодня',
  done: 'Готово',
}

function todayKey() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dueDateLabel(value: string) {
  if (!value) return 'Без срока'
  if (value === todayKey()) return 'Сегодня'
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`))
}

type TaskForm = Pick<WorkTask, 'title' | 'description' | 'color' | 'plannedMinutes' | 'dueDate' | 'status'>

const emptyForm = (): TaskForm => ({
  title: '',
  description: '',
  color: TASK_COLORS[0],
  plannedMinutes: 60,
  dueDate: todayKey(),
  status: 'planned',
})

export function TasksPage() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const ownerId = ownerIdForUser(currentUser?.id ?? 0)
  const [tasks, setTasks] = useState<WorkTask[]>(() => loadWorkTasks(ownerId))
  const [sessions, setSessions] = useState<CompletedWorkSession[]>([])
  const [form, setForm] = useState<TaskForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<WorkTaskStatus | null>(null)

  useEffect(() => {
    void loadCompletedWorkSessions(ownerId).then(setSessions).catch(() => setError('Не удалось загрузить время из истории сессий.'))
  }, [ownerId])

  const timeByTask = useMemo(() => sessions.reduce<Record<string, number>>((result, session) => {
    if (session.taskId) result[session.taskId] = (result[session.taskId] ?? 0) + session.activeDurationMs
    return result
  }, {}), [sessions])

  const totalActiveMs = Object.values(timeByTask).reduce((sum, value) => sum + value, 0)
  const openCreateForm = () => {
    setEditingId(null)
    setForm(emptyForm())
    setIsFormOpen(true)
  }
  const openEditForm = (task: WorkTask) => {
    setEditingId(task.id)
    setForm({ title: task.title, description: task.description, color: task.color, plannedMinutes: task.plannedMinutes, dueDate: task.dueDate, status: task.status })
    setIsFormOpen(true)
  }
  const refreshTasks = () => setTasks(loadWorkTasks(ownerId))
  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    const title = form.title.trim()
    if (!title) return setError('Введите название задачи.')
    const existing = editingId ? tasks.find((task) => task.id === editingId) : undefined
    const now = new Date().toISOString()
    saveWorkTask({
      id: existing?.id ?? crypto.randomUUID(),
      ownerId,
      title,
      description: form.description.trim(),
      color: form.color,
      plannedMinutes: Math.min(Math.max(Number(form.plannedMinutes) || 1, 1), 99_999),
      dueDate: form.dueDate,
      status: form.status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    setError('')
    setIsFormOpen(false)
    refreshTasks()
  }
  const startTask = (task: WorkTask) => {
    if (task.status === 'planned') saveWorkTask({ ...task, status: 'in-progress', updatedAt: new Date().toISOString() })
    navigate(`/?task=${encodeURIComponent(task.id)}`)
  }
  const toggleDone = (task: WorkTask) => {
    saveWorkTask({ ...task, status: task.status === 'done' ? 'in-progress' : 'done', updatedAt: new Date().toISOString() })
    refreshTasks()
  }
  const moveTask = (task: WorkTask, status: WorkTaskStatus) => {
    if (task.status === status) return
    saveWorkTask({ ...task, status, updatedAt: new Date().toISOString() })
    refreshTasks()
  }
  const dropTask = (event: DragEvent<HTMLElement>, status: 'planned' | 'in-progress') => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain') || draggedTaskId
    const task = tasks.find((item) => item.id === taskId)
    if (task) moveTask(task, status)
    setDraggedTaskId(null)
    setDragOverStatus(null)
  }
  const removeTask = (task: WorkTask) => {
    if (!window.confirm(`Удалить задачу «${task.title}»? Сессии останутся в истории.`)) return
    deleteWorkTask(ownerId, task.id)
    refreshTasks()
  }

  const backlogTasks = tasks.filter((task) => task.status === 'planned')
  const todayTasks = tasks.filter((task) => task.status === 'in-progress')
  const doneTasks = tasks.filter((task) => task.status === 'done')
  const renderTaskCard = (task: WorkTask) => {
    const activeMs = timeByTask[task.id] ?? 0
    const progress = taskProgress(activeMs, task.plannedMinutes)
    const moveLabel = task.status === 'planned' ? 'На сегодня →' : task.status === 'in-progress' ? '← В бэклог' : 'Вернуть на сегодня'
    const moveStatus: WorkTaskStatus = task.status === 'planned' ? 'in-progress' : task.status === 'in-progress' ? 'planned' : 'in-progress'
    return <article
      key={task.id}
      className={`task-card${task.status === 'done' ? ' task-card-done' : ''}${draggedTaskId === task.id ? ' task-card-dragging' : ''}`}
      style={{ '--task-color': task.color } as CSSProperties}
      draggable={task.status !== 'done'}
      onDragStart={(event) => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; setDraggedTaskId(task.id) }}
      onDragEnd={() => { setDraggedTaskId(null); setDragOverStatus(null) }}
    >
      <div className="task-card-top"><span className="task-status"><i />{statusLabels[task.status]}</span><div className="task-card-menu"><button type="button" onClick={() => toggleDone(task)} aria-label={task.status === 'done' ? `Вернуть ${task.title} в работу` : `Завершить ${task.title}`}>{task.status === 'done' ? '↶' : '✓'}</button><button type="button" onClick={() => openEditForm(task)} aria-label={`Изменить ${task.title}`}>Изменить</button><button type="button" onClick={() => removeTask(task)} aria-label={`Удалить ${task.title}`}>×</button></div></div>
      <div className="task-card-copy"><span>{dueDateLabel(task.dueDate)} · Работа</span><h2>{task.title}</h2>{task.description ? <p>{task.description}</p> : null}</div>
      <div className="task-time-row"><strong>{formatTaskDuration(activeMs)} / {formatTaskDuration(task.plannedMinutes * 60_000)}</strong><b className={progress.percent > 100 ? 'over' : ''}>{progress.percent}%</b></div>
      <div className="task-progress" role="progressbar" aria-label={`Прогресс задачи ${task.title}`} aria-valuenow={progress.percent}><span style={{ width: `${progress.mainWidth}%` }} />{progress.overflowWidth > 0 ? <i style={{ width: `${progress.overflowWidth}%` }} /> : null}</div>
      <p className={`task-progress-note${progress.percent > 100 ? ' over' : ''}`}>{progress.percent > 100 ? `План выполнен · +${formatTaskDuration(progress.overtimeMs)}` : progress.percent === 100 ? 'План выполнен' : activeMs === 0 ? 'Сессий пока не было' : `Осталось примерно ${formatTaskDuration(Math.max(0, task.plannedMinutes * 60_000 - activeMs))}`}</p>
      <div className="task-card-actions"><button type="button" className="primary-button" onClick={() => startTask(task)}>{activeMs > 0 ? 'Продолжить' : 'Начать'}</button><button type="button" className="secondary-button" onClick={() => moveTask(task, moveStatus)}>{moveLabel}</button></div>
    </article>
  }

  return <AppLayout title="Задачи" description="Планируйте работу и запускайте фокус-сессии прямо из карточки." variant="wellness">
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <section className="tasks-heading">
      <div><span>Фокус по задачам</span><h1>Моя работа</h1><p>{tasks.length ? `${tasks.filter((task) => task.status !== 'done').length} активных · ${formatTaskDuration(totalActiveMs)} записано` : 'Создайте первую задачу и начните рабочую сессию.'}</p></div>
      <button type="button" className="primary-button" onClick={openCreateForm}>+ Новая задача</button>
    </section>

    {isFormOpen ? <section className="task-editor-card">
      <div className="task-editor-heading"><div><span>{editingId ? 'Редактирование' : 'Новая задача'}</span><h2>{editingId ? 'Обновить карточку' : 'Что будем делать?'}</h2></div><button type="button" onClick={() => setIsFormOpen(false)} aria-label="Закрыть">×</button></div>
      <form className="task-form" onSubmit={submitTask}>
        <label className="task-title-field">Название<input autoFocus value={form.title} maxLength={120} placeholder="Например, подготовить презентацию" onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className="task-description-field">Описание<textarea value={form.description} maxLength={600} rows={3} placeholder="Что именно нужно сделать, материалы или критерий готовности" onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label>Оценка, мин.<input type="number" min="1" max="99999" value={form.plannedMinutes} onChange={(event) => setForm({ ...form, plannedMinutes: Number(event.target.value) })} /></label>
        <label>Срок<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
        <label>Статус<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as WorkTaskStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <fieldset className="task-color-field"><legend>Цвет карточки</legend><div>{TASK_COLORS.map((color) => <button key={color} type="button" className={form.color === color ? 'selected' : ''} style={{ backgroundColor: color }} onClick={() => setForm({ ...form, color })} aria-label={`Выбрать цвет ${color}`} aria-pressed={form.color === color} />)}</div></fieldset>
        <div className="task-form-actions"><button type="button" className="secondary-button" onClick={() => setIsFormOpen(false)}>Отмена</button><button type="submit" className="primary-button">{editingId ? 'Сохранить' : 'Создать задачу'}</button></div>
      </form>
    </section> : null}

    {tasks.length === 0 ? <section className="tasks-empty"><div className="tasks-empty-mark">✓</div><h2>Задач пока нет</h2><p>Добавьте оценку времени — фактическая работа сможет пройти и за 100%.</p><button type="button" className="primary-button" onClick={openCreateForm}>Создать задачу</button></section> : <>
      <section className="task-board" aria-label="Доска задач">
        <section className={`task-lane task-lane-backlog${dragOverStatus === 'planned' ? ' task-lane-dragover' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverStatus('planned') }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverStatus(null) }} onDrop={(event) => dropTask(event, 'planned')}>
          <div className="task-lane-heading"><div><span>Позже</span><h2>Бэклог</h2></div><b>{backlogTasks.length}</b></div>
          <p>Идеи и задачи без обязательства сделать их сегодня.</p>
          <div className="task-lane-list">{backlogTasks.length ? backlogTasks.map(renderTaskCard) : <div className="task-lane-empty">Перетащите сюда задачу, которую можно отложить</div>}</div>
        </section>
        <section className={`task-lane task-lane-today${dragOverStatus === 'in-progress' ? ' task-lane-dragover' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverStatus('in-progress') }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverStatus(null) }} onDrop={(event) => dropTask(event, 'in-progress')}>
          <div className="task-lane-heading"><div><span>В фокусе</span><h2>Сегодня</h2></div><b>{todayTasks.length}</b></div>
          <p>То, над чем вы действительно планируете работать сейчас.</p>
          <div className="task-lane-list">{todayTasks.length ? todayTasks.map(renderTaskCard) : <div className="task-lane-empty">Перетащите сюда задачу из бэклога</div>}</div>
        </section>
      </section>
      {doneTasks.length ? <details className="completed-tasks"><summary><span>Выполнено</span><b>{doneTasks.length}</b></summary><div className="completed-task-grid">{doneTasks.map(renderTaskCard)}</div></details> : null}
    </>}
  </AppLayout>
}
