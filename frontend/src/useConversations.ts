import { useEffect, useRef, useState } from 'react'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  sendMessage,
} from './conversations'
import type { ChatMessage, Conversation } from './conversations'

// Only selection IDs are kept locally. Message history always comes from the API.
export function useConversations(userId: string, selectPaper: (id: string) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [needsRecovery, setNeedsRecovery] = useState(false)
  const selectedRef = useRef('')
  const locked = useRef(false)
  const mounted = useRef(false)
  const detailRequest = useRef<AbortController | null>(null)
  const requests = useRef(new Set<AbortController>())
  const onSelectPaper = useRef(selectPaper)
  onSelectPaper.current = selectPaper
  const storageKey = `paperpilot:conversation:${userId}`

  function remember(id: string) {
    selectedRef.current = id
    setSelected(id)
    try {
      if (id) localStorage.setItem(storageKey, id)
      else localStorage.removeItem(storageKey)
    } catch {
      /* Selection persistence is optional. */
    }
  }

  function clearSelection() {
    detailRequest.current?.abort()
    remember('')
    setMessages([])
    setWorking(false)
    setNeedsRecovery(false)
    setError('')
  }

  async function refreshList(signal?: AbortSignal) {
    const items = await listConversations(signal)
    if (!mounted.current || signal?.aborted) return []
    // The backend returns updated_at DESC, including its tie ordering.
    const owned = items.filter((item) => item.user_id === userId)
    setConversations(owned)
    return owned
  }

  async function openConversation(id: string) {
    if (locked.current) return
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    remember(id)
    setMessages([])
    setNeedsRecovery(true)
    setError('')
    setWorking(true)
    try {
      const detail = await getConversation(id, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (detail.user_id !== userId)
        throw new Error('This conversation is not available for your account.')
      setMessages(detail.messages)
      onSelectPaper.current(detail.paper_id || '')
      setNeedsRecovery(false)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError((error as Error).message)
    } finally {
      if (mounted.current && !controller.signal.aborted) setWorking(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    setLoading(true)
    refreshList(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) clearSelection()
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      mounted.current = false
      controller.abort()
      detailRequest.current?.abort()
      requests.current.forEach((request) => request.abort())
    }
  }, [userId])

  async function newChat(paperId: string, signal?: AbortSignal) {
    if (locked.current || working || !paperId) return null
    // Repeated clicks on an already empty chat reuse it.
    const current = conversations.find((item) => item.id === selectedRef.current)
    if (current?.paper_id === paperId && messages.length === 0 && !needsRecovery) return current.id
    locked.current = true
    setWorking(true)
    setError('')
    try {
      const conversation = await createConversation(paperId, signal)
      if (!mounted.current || signal?.aborted) return null
      detailRequest.current?.abort()
      setConversations((items) => [conversation, ...items])
      remember(conversation.id)
      setMessages([])
      setNeedsRecovery(false)
      return conversation.id
    } finally {
      locked.current = false
      if (mounted.current) setWorking(false)
    }
  }

  async function send(id: string, question: string, signal: AbortSignal) {
    if (locked.current || needsRecovery)
      throw new Error('Load the conversation before sending another question.')
    locked.current = true
    try {
      const saved = await sendMessage(id, question, signal)
      if (!mounted.current || signal.aborted || selectedRef.current !== id) return
      setMessages((previous) => {
        const ids = new Set(previous.map((message) => message.id))
        return [...previous, ...saved.filter((message) => !ids.has(message.id))]
      })
      // A list failure must not turn a saved answer into a failed send.
      await refreshList(signal).catch((error: Error) => {
        if (!signal.aborted && mounted.current)
          setError(`Your answer was saved. Could not refresh chats: ${error.message}`)
      })
    } catch (error) {
      if (!mounted.current || signal.aborted) throw error
      // Generation can fail after saving the user's question. Recover before a retry.
      setNeedsRecovery(true)
      try {
        const detail = await getConversation(id, signal)
        if (mounted.current && !signal.aborted && selectedRef.current === id) {
          if (detail.user_id !== userId)
            throw new Error('This conversation is not available for your account.')
          setMessages(detail.messages)
          setNeedsRecovery(false)
        }
      } catch {
        if (mounted.current && !signal.aborted)
          setError(
            'Could not reload saved messages. Reload this conversation before sending again.',
          )
      }
      await refreshList(signal).catch(() => {})
      throw error
    } finally {
      locked.current = false
    }
  }

  async function remove(id: string) {
    if (locked.current || working) return
    locked.current = true
    setWorking(true)
    setError('')
    const controller = new AbortController()
    requests.current.add(controller)
    try {
      await deleteConversation(id, controller.signal)
      if (!mounted.current) return
      setConversations((items) => items.filter((item) => item.id !== id))
      if (selectedRef.current === id) clearSelection()
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError((error as Error).message)
    } finally {
      requests.current.delete(controller)
      locked.current = false
      if (mounted.current) setWorking(false)
    }
  }

  async function reload() {
    if (locked.current || working) return
    if (selectedRef.current) return openConversation(selectedRef.current)
    const controller = new AbortController()
    requests.current.add(controller)
    setLoading(true)
    setError('')
    try {
      await refreshList(controller.signal)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError((error as Error).message)
    } finally {
      requests.current.delete(controller)
      if (mounted.current) setLoading(false)
    }
  }

  return {
    conversations,
    selected,
    messages,
    loading,
    working,
    error,
    needsRecovery,
    openConversation,
    clearSelection,
    newChat,
    send,
    remove,
    reload,
  }
}
