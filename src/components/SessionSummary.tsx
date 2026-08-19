import { formatSessionDuration } from '../lib/eyeMetrics'
import type { CompletedWorkSession, TimelineSegmentType } from '../lib/workSessions'

const timelineLabels: Record<TimelineSegmentType, string> = {
  active: 'У экрана',
  away: 'Отошёл',
  'manual-pause': 'Ручная пауза',
  'pomodoro-break': 'Перерыв Pomodoro',
  untracked: 'Нет данных',
}

const eyeLabels = {
  comfortable: 'Комфортно',
  strained: 'Есть напряжение',
  'rest-recommended': 'Нужен отдых',
  'insufficient-data': 'Недостаточно данных',
} as const

function formatClock(isoDate: string, offsetMs = 0) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(new Date(isoDate).getTime() + offsetMs))
}

function scorePart(value: number | null, maximum: number) {
  return value === null ? 'Нет данных' : `${Math.round(value * 10) / 10} / ${maximum}`
}

type SessionSummaryProps = {
  session: CompletedWorkSession
  saveError?: string
  onRetrySave?: () => void
  onNewSession?: () => void
  onViewHistory?: () => void
  onDelete?: () => void
}

export function SessionSummary({ session, saveError, onRetrySave, onNewSession, onViewHistory, onDelete }: SessionSummaryProps) {
  const significantEvents = session.timeline.filter((segment) => segment.type !== 'active')
  return (
    <div className="session-summary">
      {saveError ? <div className="summary-save-error" role="alert"><span>{saveError}</span>{onRetrySave ? <button type="button" className="secondary-button" onClick={onRetrySave}>Повторить сохранение</button> : null}</div> : null}

      <section className="summary-hero" aria-labelledby="session-summary-title">
        <div className="summary-score">
          <span>Оценка продуктивности сессии</span>
          <strong>{session.score.total ?? '—'} <small>/ 100</small></strong>
          {session.score.measurementCoverage < 0.6 ? <em>Оценка основана на доступной части данных</em> : null}
        </div>
        <div className="summary-verdict">
          <span>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(session.completedAt))}</span>
          <h1 id="session-summary-title">{session.summaryLabel}</h1>
          <p>{session.summaryReason}</p>
          {session.goal ? <div className="summary-goal"><span>Цель</span><strong>{session.goal}</strong></div> : null}
        </div>
      </section>

      <section className="summary-metrics" aria-label="Главные показатели сессии">
        <article><span>Активное время</span><strong>{formatSessionDuration(session.activeDurationMs)}</strong><small>{scorePart(session.score.presencePoints, 50)} за присутствие</small></article>
        <article><span>Время вне экрана</span><strong>{formatSessionDuration(session.awayDurationMs)}</strong><small>{session.awayEventCount} уходов · {scorePart(session.score.stabilityPoints, 30)} за ритм</small></article>
        <article><span>Состояние глаз</span><strong>{eyeLabels[session.eyeState]}</strong><small>{scorePart(session.score.eyePoints, 20)} за комфорт</small></article>
      </section>

      <section className="recommendation-card">
        <span>Что попробовать дальше</span>
        <p>{session.recommendation}</p>
      </section>

      <section className="timeline-card" aria-labelledby="timeline-title">
        <div className="summary-section-heading"><div><span>Вся сессия</span><h2 id="timeline-title">Таймлайн</h2></div><strong>{formatSessionDuration(session.totalDurationMs)}</strong></div>
        {session.timeline.length > 0 ? (
          <>
            <div className="session-timeline" aria-label="Распределение времени сессии">
              {session.timeline.map((segment, index) => {
                const duration = Math.max(0, segment.endOffsetMs - segment.startOffsetMs)
                const title = `${timelineLabels[segment.type]}: ${formatClock(session.startedAt, segment.startOffsetMs)}–${formatClock(session.startedAt, segment.endOffsetMs)}, ${formatSessionDuration(duration)}`
                return <span key={`${segment.startOffsetMs}-${index}`} className={`timeline-segment timeline-${segment.type}`} style={{ flexGrow: duration, flexBasis: 0 }} tabIndex={0} title={title} aria-label={title} />
              })}
            </div>
            <div className="timeline-scale"><span>{formatClock(session.startedAt)}</span><span>{formatClock(session.completedAt)}</span></div>
            <div className="timeline-legend">{(Object.keys(timelineLabels) as TimelineSegmentType[]).map((type) => <span key={type}><i className={`timeline-${type}`} />{timelineLabels[type]}</span>)}</div>
          </>
        ) : <p className="empty-copy">Для старой записи подробный таймлайн недоступен.</p>}

        {significantEvents.length > 0 ? <div className="timeline-events"><h3>Значимые события</h3>{significantEvents.map((segment, index) => {
          const duration = segment.endOffsetMs - segment.startOffsetMs
          return <article key={`${segment.startOffsetMs}-${index}`}><i className={`timeline-${segment.type}`} /><div><strong>{timelineLabels[segment.type]}</strong><span>{formatClock(session.startedAt, segment.startOffsetMs)} · {formatSessionDuration(duration)}</span></div></article>
        })}</div> : null}
      </section>

      <div className="summary-actions">
        {onNewSession ? <button type="button" className="primary-button" onClick={onNewSession}>Новая сессия</button> : null}
        {onViewHistory ? <button type="button" className="secondary-button" onClick={onViewHistory}>Посмотреть историю</button> : null}
        {onDelete ? <button type="button" className="secondary-button session-delete-button" onClick={onDelete}>Удалить сессию</button> : null}
      </div>
    </div>
  )
}
