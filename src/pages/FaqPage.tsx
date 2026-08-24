import { AppLayout } from '../components/AppLayout'

const questions = [
  {
    question: 'Нужен ли аккаунт для EyeGuard?',
    answer:
      'Нет. EyeGuard работает в гостевом режиме и не запрашивает имя, email, телефон или пароль. Серверный профиль пользователя не создается.',
  },
  {
    question: 'Где хранятся история и настройки?',
    answer:
      'История сессий, задачи, калибровка и настройки сохраняются только в браузере на текущем устройстве. Они не синхронизируются с сервером и не появятся в другом браузере.',
  },
  {
    question: 'Использует ли EyeGuard аналитику и cookie?',
    answer:
      'EyeGuard использует Vercel Web Analytics для агрегированной статистики посещений, страниц, источников перехода, примерной географии, браузеров и устройств. Аналитика не использует сторонние cookie-файлы и не показывает владельцу личность посетителя. Видео, история, задачи и показатели камеры в аналитику не передаются.',
  },
  {
    question: 'Передается ли видео с камеры на сервер?',
    answer:
      'По текущей архитектуре видео, кадры, точки лица и сырые показатели камеры обрабатываются на устройстве и не отправляются владельцу сайта.',
  },
  {
    question: 'Как остановить использование камеры?',
    answer:
      'Завершите мониторинг или закройте страницу. Приложение должно остановить все tracks медиапотока. Техническое разрешение также можно отозвать в настройках сайта в браузере.',
  },
  {
    question: 'Как удалить локальные данные?',
    answer:
      'Историю можно очистить в разделе «История». Для полной очистки настроек, задач и IndexedDB можно удалить данные сайта средствами браузера. Отдельную кнопку «Очистить данные этого браузера» планируется добавить как удобную функцию, а не как удаление аккаунта.',
  },
  {
    question: 'Является ли EyeGuard медицинским сервисом?',
    answer:
      'Нет. EyeGuard не ставит диагнозы, не лечит заболевания и не заменяет врача. Результаты являются ориентировочными напоминаниями для организации работы и перерывов.',
  },
]

export function FaqPage() {
  return (
    <AppLayout
      title="FAQ и приватность"
      description="Короткие ответы о гостевом режиме, камере, локальных данных и требованиях к запуску EyeGuard."
      variant="wellness"
    >
      <section className="faq-intro">
        <span className="eyebrow">Помощь и приватность</span>
        <h1>Частые вопросы об EyeGuard</h1>
        <p>
          Как работает гостевой режим, что происходит с камерой и какие данные остаются
          в этом браузере.
        </p>
      </section>
      <section className="faq-list">
        {questions.map(({ question, answer }, index) => (
          <details className="faq-item" key={question} open={index === 0}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>

      <section className="faq-owner" aria-labelledby="faq-owner-title">
        <div>
          <span className="eyebrow">Владелец и контакты</span>
          <h2 id="faq-owner-title">Информация о проекте EyeGuard</h2>
        </div>
        <dl>
          <div>
            <dt>Владелец проекта EyeGuard</dt>
            <dd>Артемий Горлатов</dd>
          </div>
          <div>
            <dt>Статус владельца</dt>
            <dd>Физическое лицо</dd>
          </div>
          <div>
            <dt>Местонахождение</dt>
            <dd>Россия, Москва</dd>
          </div>
          <div>
            <dt>Email для обращений</dt>
            <dd><a href="mailto:eyeguardhelp@mail.ru">eyeguardhelp@mail.ru</a></dd>
          </div>
          <div>
            <dt>Telegram проекта</dt>
            <dd><a href="https://t.me/blinkmind" target="_blank" rel="noreferrer">@blinkmind</a></dd>
          </div>
        </dl>
      </section>
    </AppLayout>
  )
}
