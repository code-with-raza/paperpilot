import { useEffect, useRef, useState } from 'react'
import { loadStoredPdf, saveStoredPdf } from './pdfStorage'
import { fetchPaperPdf } from './api'

type Preview = { url: string; name: string }
const previewKey = (userId: string, paperId: string) => JSON.stringify([userId, paperId])

export function usePaperPreview(userId: string, paperId: string, filename: string) {
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [warning, setWarning] = useState<{ key: string; text: string } | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const mounted = useRef(true)
  const urls = useRef(new Set<string>())
  const revisions = useRef(new Map<string, number>())
  const key = previewKey(userId, paperId)
  const pdf = previews[key]

  useEffect(() => {
    if (!paperId || pdf) return
    let cancelled = false
    const controller = new AbortController()
    const revision = revisions.current.get(key)
    setLoadingKey(key)
    setWarning(null)
    async function loadPreview() {
      try {
        return {
          file: await fetchPaperPdf(paperId, controller.signal),
          name: filename,
          warning: '',
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const reason = (error as Error).message
        const stored = await loadStoredPdf(userId, paperId).catch(() => undefined)
        if (stored)
          return {
            ...stored,
            warning: `Showing your saved local copy. Server preview unavailable: ${reason}`,
          }
        throw new Error(`Could not load this paper's PDF: ${reason}`)
      }
    }
    loadPreview()
      .then((stored) => {
        if (cancelled || revisions.current.get(key) !== revision || !stored) return
        const url = URL.createObjectURL(stored.file)
        urls.current.add(url)
        setPreviews((previous) => ({ ...previous, [key]: { url, name: stored.name } }))
        if (stored.warning) setWarning({ key, text: stored.warning })
      })
      .catch((error: Error) => {
        if (!cancelled && revisions.current.get(key) === revision)
          setWarning({ key, text: error.message })
      })
      .finally(() => {
        if (!cancelled) setLoadingKey(null)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [userId, paperId, filename, key, pdf, retryCount])

  useEffect(() => {
    mounted.current = true
    const ownedUrls = urls.current
    return () => {
      mounted.current = false
      ownedUrls.forEach((url) => URL.revokeObjectURL(url))
      ownedUrls.clear()
    }
  }, [])

  async function attachPdf(id: string, file: File) {
    if (!mounted.current) return false
    const attachedKey = previewKey(userId, id)
    revisions.current.set(attachedKey, (revisions.current.get(attachedKey) || 0) + 1)
    const url = URL.createObjectURL(file)
    urls.current.add(url)
    setPreviews((previous) => ({ ...previous, [attachedKey]: { url, name: file.name } }))
    setWarning(null)
    try {
      await saveStoredPdf(userId, id, file)
      return true
    } catch {
      if (mounted.current)
        setWarning({
          key: attachedKey,
          text: 'This PDF is open, but could not be saved in browser storage. You may need to attach it again after refreshing.',
        })
      return false
    }
  }

  function retryPreview() {
    setPreviews((previous) => {
      const next = { ...previous }
      delete next[key]
      return next
    })
    setRetryCount((value) => value + 1)
  }

  return {
    pdf,
    attachPdf,
    retry: retryPreview,
    loading: !pdf && loadingKey === key,
    warning: warning?.key === key ? warning.text : '',
  }
}
