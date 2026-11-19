import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Eye,
  EyeOff,
  Info,
  LoaderCircle,
} from 'lucide-react'
import { EMAIL_VERIFICATION_MESSAGE, submitAuth, validateAuthFields } from './auth'
import type { AuthErrors, AuthFields, AuthMode, User } from './auth'
import { ApiError } from './api'

export default function AuthPage({
  mode,
  onAuthenticated,
  notice,
  initialEmail = '',
  onContinueToLogin,
}: {
  mode: AuthMode
  onAuthenticated: (user: User) => void
  notice?: string
  initialEmail?: string
  onContinueToLogin?: (email: string) => void
}) {
  const isRegister = mode === 'register'
  const [fields, setFields] = useState<AuthFields>({ email: initialEmail, password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<AuthErrors>({})
  const [submitError, setSubmitError] = useState('')
  const [verificationPending, setVerificationPending] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const submitting = useRef(false)
  const mounted = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    mounted.current = true
    const previousTitle = document.title
    document.title = `${verificationPending ? 'Check your email' : isRegister ? 'Register' : 'Log in'} — PaperPilot`
    heading.current?.focus()
    return () => {
      mounted.current = false
      document.title = previousTitle
    }
  }, [isRegister, verificationPending])

  function updateField(name: keyof AuthFields, value: string) {
    setFields((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({
      ...previous,
      [name]: undefined,
      ...(name === 'password' ? { confirmPassword: undefined } : {}),
    }))
    setSubmitError('')
    setAccountExists(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return

    const fieldErrors = validateAuthFields(mode, fields)
    setErrors(fieldErrors)
    setSubmitError('')
    setAccountExists(false)
    const firstInvalidField = Object.keys(fieldErrors)[0]
    if (firstInvalidField) {
      document.getElementById(`auth-${firstInvalidField}`)?.focus()
      return
    }

    submitting.current = true
    setLoading(true)
    try {
      const result = await submitAuth(mode, { ...fields, email: fields.email.trim() })
      if (!mounted.current) return
      if (result.status === 'verification_pending') {
        setVerificationPending(true)
        setFields((previous) => ({ ...previous, password: '', confirmPassword: '' }))
        setShowPassword(false)
      } else {
        onAuthenticated(result.user)
      }
    } catch (error) {
      if (mounted.current) {
        setSubmitError((error as Error).message)
        setAccountExists(isRegister && error instanceof ApiError && error.status === 409)
      }
    } finally {
      submitting.current = false
      if (mounted.current) setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="brand" href="#/" aria-label="PaperPilot workspace">
          <BookOpen size={31} strokeWidth={1.8} />
          <span>
            PaperPilot AI
          </span>
        </a>
        {isRegister && (
        <a className="auth-back" href="#/">
          <ArrowLeft size={15} />
          Back to workspace
        </a>
        )}
      </header>

      <main className="auth-layout">
        <section className="auth-intro" aria-labelledby="auth-intro-title">
          <span className="auth-symbol">
            <BookOpen size={27} strokeWidth={1.5} />
          </span>
          <span className="eyebrow">A LITTLE MORE CLARITY</span>
          <h1 id="auth-intro-title">
            Big ideas.
            <br />A clearer direction<span className="teal-dot">.</span>
          </h1>
          <p>
            A familiar space for your papers, your questions, and the evidence that connects them.
          </p>
          <div className="auth-intro-note">
            <span className="status-dot" />
            Made for curious minds.
          </div>
        </section>

        <section className="auth-card" aria-labelledby="auth-form-title">
          <span className="eyebrow">{isRegister ? 'GET STARTED' : 'WELCOME TO PAPERPILOT'}</span>
          <h2 ref={heading} tabIndex={-1} id="auth-form-title">
            {verificationPending
              ? 'Check your email.'
              : isRegister
                ? 'Create your account.'
                : 'Welcome back.'}
          </h2>
          <p className="auth-description">
            {verificationPending
              ? 'One more step before you can sign in.'
              : isRegister
                ? 'Make yourself at home in your research.'
                : 'A fresh perspective is waiting for you.'}
          </p>

          <div className="auth-availability" role={verificationPending ? 'status' : undefined}>
            <Info size={16} />
            <p>
              {verificationPending
                ? EMAIL_VERIFICATION_MESSAGE
                : notice || 'Sign in to keep your papers and conversations together.'}
            </p>
          </div>

          {verificationPending && (
            <div className="auth-field-help">
              <p>Check the inbox for <strong>{fields.email.trim()}</strong>, including Spam or Junk.</p>
              <p>Open the confirmation link in your email, then return here and log in with the password you chose.</p>
              <p>No email yet? Wait a few minutes before trying again. You do not need to create another account.</p>
            </div>
          )}

          {!verificationPending && (
            <form noValidate onSubmit={handleSubmit} aria-busy={loading}>
              {submitError && (
                <div role="alert" className="auth-error">
                  <Info size={16} />
                  <span>
                    {submitError}
                    {accountExists && (
                      <>
                        <br />
                        <a href="#/login" onClick={() => onContinueToLogin?.(fields.email.trim())}>
                          Log in to your existing account
                        </a>
                      </>
                    )}
                  </span>
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="auth-email">Email address</label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete={isRegister ? 'email' : 'username'}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@example.com"
                  required
                  disabled={loading}
                  value={fields.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'auth-email-error' : undefined}
                />
                {errors.email && (
                  <p id="auth-email-error" className="auth-field-error">
                    {errors.email}
                  </p>
                )}
              </div>

              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <div className="auth-password">
                  <input
                    id="auth-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    required
                    disabled={loading}
                    value={fields.password}
                    onChange={(event) => updateField('password', event.target.value)}
                    aria-invalid={!!errors.password}
                    aria-describedby={
                      errors.password
                        ? 'auth-password-error'
                        : isRegister
                          ? 'auth-password-help'
                          : undefined
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    disabled={loading}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    aria-controls="auth-password"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password ? (
                  <p id="auth-password-error" className="auth-field-error">
                    {errors.password}
                  </p>
                ) : (
                  isRegister && (
                    <p id="auth-password-help" className="auth-field-help">
                      Use 8–128 characters. A longer passphrase works well.
                    </p>
                  )
                )}
              </div>

              {isRegister && (
                <div className="auth-field">
                  <label htmlFor="auth-confirmPassword">Confirm password</label>
                  <input
                    id="auth-confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    disabled={loading}
                    value={fields.confirmPassword}
                    onChange={(event) => updateField('confirmPassword', event.target.value)}
                    aria-invalid={!!errors.confirmPassword}
                    aria-describedby={
                      errors.confirmPassword ? 'auth-confirmPassword-error' : undefined
                    }
                  />
                  {errors.confirmPassword && (
                    <p id="auth-confirmPassword-error" className="auth-field-error">
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>
              )}

              <button className="primary auth-submit" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <LoaderCircle size={17} className="spin" />
                    {isRegister ? 'Registering…' : 'Logging in…'}
                  </>
                ) : (
                  <>
                    {isRegister ? 'Register' : 'Log in'}
                    <ArrowRight size={17} className="auth-submit-arrow" />
                  </>
                )}
              </button>
            </form>
          )}

          <p className="auth-switch">
            {verificationPending
              ? 'Already verified your email?'
              : isRegister
                ? 'Already have an account?'
                : 'New to PaperPilot?'}{' '}
            <a href={isRegister ? '#/login' : '#/register'} onClick={() => {
              if (isRegister) onContinueToLogin?.(fields.email.trim())
            }}>
              {isRegister ? 'Log in' : 'Create an account'}
            </a>
          </p>
        </section>
      </main>
      <footer className="auth-footer">Your papers. Your questions. Every answer, grounded.</footer>
    </div>
  )
}
