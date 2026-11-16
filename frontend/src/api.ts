export interface Paper {
  paper_id: string
  filename: string
  status: string
  created_at?: string
}

export interface PaperResult {
  paper_id: string
  filename: string
  status?: string
  created_at?: string
}

// Only a complete URL is imported. Questions that contain links remain questions.
export function getPaperUrl(text: string): string | null {
  try {
    const url = new URL(text.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (/\s/.test(text.trim())) return null

    if (['arxiv.org', 'www.arxiv.org'].includes(url.hostname.toLowerCase())) {
      const match = url.pathname.match(/^\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?\/?$/i)
      // The backend converts abstract URLs to PDFs. Normalize PDF links here
      // so it does not accidentally append a second .pdf extension.
      return match ? `https://arxiv.org/abs/${match[1]}` : null
    }

    return url.pathname.toLowerCase().endsWith('.pdf') ? url.href : null
  } catch {
    return null
  }
}

const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function requestResponse(path: string, options?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, { ...options, credentials: 'include' })
  } catch {
    if (options?.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    throw new Error(
      'Could not connect to PaperPilot. Check that your API is running, then try again.',
    )
  }
  if (!response.ok) {
    if (response.status === 401 && !options?.signal?.aborted && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('paperpilot:session-expired'))
    }
    const payload = await response.json().catch(() => null)
    const detail = payload?.detail
    if (response.status === 404 && path === '/import-url/') {
      throw new Error(
        'URL importing is unavailable. Check that the backend has reloaded its /import-url/ route.',
      )
    }
    const validationMessage = Array.isArray(detail)
      ? detail
          .map((item: { msg?: string }) => item.msg)
          .filter(Boolean)
          .join(' ')
      : ''
    throw new ApiError(
      typeof detail === 'string'
        ? detail
        : validationMessage ||
            `The request could not be completed (${response.status}). Please try again.`,
      response.status,
    )
  }
  return response
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await requestResponse(path, options)
  try {
    return (await response.json()) as T
  } catch {
    if (options?.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    throw new Error(
      'The API returned an unexpected response. Check the API URL and proxy configuration.',
    )
  }
}

export async function fetchPaperPdf(paperId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await requestResponse(`/papers/${encodeURIComponent(paperId)}/pdf`, { signal })
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) {
    throw new Error(
      'The PDF endpoint did not return a PDF document. Check that the backend has reloaded the new PDF route.',
    )
  }
  const pdf = await response.blob()
  if ((await pdf.slice(0, 5).text()) !== '%PDF-') {
    throw new Error('The server returned an unreadable PDF file.')
  }
  return pdf
}

export async function listPapers(signal?: AbortSignal) {
  const data = await request<{ papers: Paper[] }>('/papers/', { signal })
  if (
    !data ||
    !Array.isArray(data.papers) ||
    data.papers.some(
      (paper) =>
        !paper ||
        typeof paper.paper_id !== 'string' ||
        !paper.paper_id ||
        typeof paper.filename !== 'string' ||
        typeof paper.status !== 'string',
    )
  ) {
    throw new Error(
      'The API returned an invalid paper library. Please refresh or check the backend response.',
    )
  }
  return data
}

export function uploadPaper(file: File, signal?: AbortSignal) {
  const data = new FormData()
  data.append('file', file)
  return request<PaperResult>('/uploadfile/', { method: 'POST', body: data, signal })
}

export function importPaperFromUrl(pdfUrl: string, signal?: AbortSignal) {
  return request<PaperResult>('/import-url/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdf_url: pdfUrl,
    }),
    signal,
  })
}

export function retryPaperProcessing(paperId: string, signal?: AbortSignal) {
  return request<{ paper_id: string; status: string; message: string }>(
    `/papers/${encodeURIComponent(paperId)}/retry`,
    { method: 'POST', signal },
  )
}
