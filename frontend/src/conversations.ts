import { request } from './api'

export interface Conversation {
  id: string
  user_id: string
  title: string
  paper_id: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  sources: Record<string, unknown>[] | null
  created_at: string
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[]
}

const path = (id: string) => `/conversations/${encodeURIComponent(id)}`

export function listConversations(signal?: AbortSignal) {
  return request<Conversation[]>('/conversations/', { signal })
}

export function getConversation(id: string, signal?: AbortSignal) {
  return request<ConversationDetail>(path(id), { signal })
}

export function createConversation(paperId: string, signal?: AbortSignal) {
  return request<Conversation>('/conversations/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New chat', paper_id: paperId }),
    signal,
  })
}

export function sendMessage(id: string, question: string, signal?: AbortSignal) {
  return request<ChatMessage[]>(`${path(id)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  })
}

export function deleteConversation(id: string, signal?: AbortSignal) {
  return request<{ message: string }>(path(id), { method: 'DELETE', signal })
}
