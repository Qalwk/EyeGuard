import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppLayout } from '../components/AppLayout'
import { SessionSummary } from '../components/SessionSummary'
import { useAuth } from '../context/AuthContext'
import { deleteCompletedWorkSession, loadCompletedWorkSession, ownerIdForUser, type CompletedWorkSession } from '../lib/workSessions'

export function SessionDetailPage() {
  const { sessionId = '' } = useParams()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [session, setSession] = useState<CompletedWorkSession | null>(null)
  const [message, setMessage] = useState('Загружаем итог…')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let active = true
    void loadCompletedWorkSession(sessionId).then((result) => {
      if (!active) return
      const ownerId = ownerIdForUser(currentUser?.id ?? 0)
      if (!result || (result.ownerId !== ownerId && result.ownerId !== 'legacy')) {
        setMessage('Сессия не найдена или принадлежит другому пользователю.')
        return
      }
      setSession(result)
    }).catch(() => setMessage('Не удалось открыть итог сессии.'))
    return () => { active = false }
  }, [currentUser?.id, sessionId])

  const handleDelete = async () => {
    if (!session || !window.confirm('Удалить эту сессию? Восстановить её не получится.')) return
    try {
      await deleteCompletedWorkSession(session.id)
      navigate('/history')
    } catch {
      setActionError('Не удалось удалить сессию. Попробуйте ещё раз.')
    }
  }

  return <AppLayout title="Итог сессии" description="Подробный результат из локальной истории." variant="wellness">
    {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
    {session ? <SessionSummary session={session} onNewSession={() => navigate('/')} onViewHistory={() => navigate('/history')} onDelete={() => void handleDelete()} /> : <section className="history-empty"><p>{message}</p><button type="button" className="secondary-button" onClick={() => navigate('/history')}>Вернуться в историю</button></section>}
  </AppLayout>
}
