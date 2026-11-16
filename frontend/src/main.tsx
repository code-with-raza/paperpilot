import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AuthPage from './AuthPage'
import { getCurrentUser, logout } from './auth'
import type { AuthMode, User } from './auth'
import { ApiError } from './api'
import './styles.css'

function currentAuthPage(): AuthMode {
  return window.location.hash === '#/register' ? 'register' : 'login'
}

function Root() {
  const [authPage, setAuthPage] = React.useState(currentAuthPage)
  const [user, setUser] = React.useState<User | null>(null)
  const [checking, setChecking] = React.useState(true)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [retry, setRetry] = React.useState(0)
  const [loggingOut, setLoggingOut] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    setChecking(true)
    setError('')
    getCurrentUser(controller.signal)
      .then((currentUser) => {
        if (!controller.signal.aborted) setUser(currentUser)
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return
        setUser(null)
        if (!(error instanceof ApiError && error.status === 401)) setError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [retry])

  React.useEffect(() => {
    const handleNavigation = () => setAuthPage(currentAuthPage())
    function expireSession() {
      setUser(null)
      setNotice('Your session has expired. Please sign in again.')
      window.location.hash = '/login'
    }
    window.addEventListener('hashchange', handleNavigation)
    window.addEventListener('paperpilot:session-expired', expireSession)
    return () => {
      window.removeEventListener('hashchange', handleNavigation)
      window.removeEventListener('paperpilot:session-expired', expireSession)
    }
  }, [])

  function authenticated(currentUser: User) {
    setUser(currentUser)
    setNotice('')
    setError('')
    window.location.hash = '/'
  }

  async function signOut() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      setUser(null) // Unmount all account-specific state, abort requests and release PDFs.
      setNotice('You have been logged out.')
      window.location.hash = '/login'
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setLoggingOut(false)
    }
  }

  if (checking || (!user && error))
    return (
      <main className="session-status" aria-live="polite">
        <span className="eyebrow">PAPERPILOT</span>
        <h1>{checking ? 'Opening your workspace...' : 'Could not check your session.'}</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button className="primary" onClick={() => setRetry((value) => value + 1)}>
              Try again
            </button>
          </>
        )}
      </main>
    )

  if (!user)
    return (
      <AuthPage key={authPage} mode={authPage} onAuthenticated={authenticated} notice={notice} />
    )
  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="text-button" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
      <App key={user.id} user={user} onLogout={signOut} loggingOut={loggingOut} />
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
