export interface Paper {
  paper_id: string
  filename: string
  status: string
  created_at?: string
}

const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, options)
  } catch {
    throw new Error('Could not connect to PaperPilot. Check that your API is running, then try again.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = payload?.detail
    throw new Error(typeof detail === 'string' ? detail : `The request could not be completed (${response.status}). Please try again.`)
  }
  return response.json() as Promise<T>
}

export function listPapers(userId: string, signal?: AbortSignal) {
  return request<{ papers: Paper[] }>(`/papers/?user_id=${encodeURIComponent(userId)}`, { signal })
}

export function uploadPaper(file: File, userId: string) {
  const data = new FormData()
  data.append('file', file)
  data.append('user_id', userId)
  return request<{ paper_id: string; filename: string }>('/uploadfile/', { method: 'POST', body: data })
}

export function askPaper(paperId: string, userId: string, question: string) {
  return request<{ answer: string }>(`/papers/${encodeURIComponent(paperId)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, question }),
  })
}
