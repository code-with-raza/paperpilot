import { ApiError, request } from './api'

export type AuthMode = 'login' | 'register'

export const EMAIL_VERIFICATION_MESSAGE =
  "Your account has been created successfully! Please check your email inbox (or Gmail) for the verification link. If you don't see it, check your Spam or Junk folder. Verify your email before logging in."

export interface AuthFields {
  email: string
  password: string
  confirmPassword: string
}

export type AuthErrors = Partial<Record<keyof AuthFields, string>>

export function validateAuthFields(mode: AuthMode, fields: AuthFields): AuthErrors {
  const errors: AuthErrors = {}
  const email = fields.email.trim()

  if (!email) {
    errors.email = 'Enter your email address.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.'
  }

  if (!fields.password.trim()) {
    errors.password = 'Enter your password.'
  } else if (mode === 'register' && (fields.password.length < 8 || fields.password.length > 128)) {
    errors.password = 'Use between 8 and 128 characters for your password.'
  }

  if (mode === 'register') {
    if (!fields.confirmPassword) {
      errors.confirmPassword = 'Confirm your password.'
    } else if (fields.confirmPassword !== fields.password) {
      errors.confirmPassword = 'Your passwords do not match.'
    }
  }

  return errors
}

export interface User {
  id: string
  email: string
  created_at: string
}

export function getCurrentUser(signal?: AbortSignal) {
  return request<User>('/auth/me', { signal })
}

export type AuthResult =
  { status: 'authenticated'; user: User } | { status: 'verification_pending' }

export async function submitAuth(mode: AuthMode, fields: AuthFields): Promise<AuthResult> {
  if (Object.keys(validateAuthFields(mode, fields)).length > 0) {
    throw new Error('Please check the highlighted fields.')
  }
  try {
    await request<User>(`/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fields.email.trim(), password: fields.password }),
    })
  } catch (error) {
    // The existing backend uses this specific 403 after signup creates a user
    // without a session. Other forbidden responses remain ordinary errors.
    if (
      mode === 'register' &&
      error instanceof ApiError &&
      error.status === 403 &&
      error.message.trim() === 'Please verify your email before logging in.'
    ) {
      return { status: 'verification_pending' }
    }
    throw error
  }
  // Verify the HTTP-only cookie before opening the workspace.
  try {
    return { status: 'authenticated', user: await getCurrentUser() }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error(
        'The server could not confirm your session cookie. Check the backend cookie settings and use the same site for the frontend and API.',
      )
    }
    throw error
  }
}

export function logout() {
  return request<{ message: string }>('/auth/logout', { method: 'POST' })
}
