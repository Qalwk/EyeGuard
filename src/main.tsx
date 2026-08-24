import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import type { BeforeSendEvent } from '@vercel/analytics/react'
import './index.css'
import App from './App.tsx'

function sanitizeAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url)
    url.search = ''
    url.hash = ''

    if (/^\/history\/[^/]+$/.test(url.pathname)) {
      url.pathname = '/history/session'
    }

    return { ...event, url: url.toString() }
  } catch {
    return null
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Analytics beforeSend={sanitizeAnalyticsEvent} />
    </BrowserRouter>
  </StrictMode>,
)
