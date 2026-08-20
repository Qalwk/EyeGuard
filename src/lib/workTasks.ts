export const WORK_TASKS_STORAGE_KEY = 'eyeguard-work-tasks-v1'

export const TASK_COLORS = ['#6fae2d', '#0f8f72', '#4f7bd9', '#8b67d5', '#e08a38', '#d15f70'] as const

export type WorkTaskStatus = 'planned' | 'in-progress' | 'done'

export type WorkTask = {
  id: string
  ownerId: string
  title: string
  description: string
  color: string
  plannedMinutes: number
  dueDate: string
  status: WorkTaskStatus
  createdAt: string
  updatedAt: string
}

function readAllTasks(): WorkTask[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORK_TASKS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((task): task is WorkTask => (
      typeof task?.id === 'string'
      && typeof task?.ownerId === 'string'
      && typeof task?.title === 'string'
      && typeof task?.plannedMinutes === 'number'
    )).map((task) => ({ ...task, description: typeof task.description === 'string' ? task.description : '' }))
  } catch {
    return []
  }
}

function writeAllTasks(tasks: WorkTask[]) {
  window.localStorage.setItem(WORK_TASKS_STORAGE_KEY, JSON.stringify(tasks))
}

export function loadWorkTasks(ownerId: string) {
  return readAllTasks()
    .filter((task) => task.ownerId === ownerId)
    .sort((first, second) => first.status === second.status
      ? second.updatedAt.localeCompare(first.updatedAt)
      : first.status === 'done' ? 1 : second.status === 'done' ? -1 : 0)
}

export function findWorkTask(ownerId: string, taskId: string) {
  return readAllTasks().find((task) => task.ownerId === ownerId && task.id === taskId)
}

export function saveWorkTask(task: WorkTask) {
  const tasks = readAllTasks()
  const index = tasks.findIndex((item) => item.id === task.id && item.ownerId === task.ownerId)
  if (index >= 0) tasks[index] = task
  else tasks.push(task)
  writeAllTasks(tasks)
  return task
}

export function deleteWorkTask(ownerId: string, taskId: string) {
  writeAllTasks(readAllTasks().filter((task) => task.ownerId !== ownerId || task.id !== taskId))
}

export function taskProgress(activeDurationMs: number, plannedMinutes: number) {
  const plannedMs = Math.max(0, plannedMinutes) * 60_000
  const percent = plannedMs > 0 ? Math.round((Math.max(0, activeDurationMs) / plannedMs) * 100) : 0
  return {
    percent,
    mainWidth: Math.min(percent, 100),
    overflowWidth: Math.min(Math.max(percent - 100, 0), 100),
    overtimeMs: Math.max(0, activeDurationMs - plannedMs),
  }
}

export function formatTaskDuration(durationMs: number) {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} мин`
  if (minutes === 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин`
}
