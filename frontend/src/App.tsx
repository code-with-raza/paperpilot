import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Bell,
  Users,
  Folder,
  MoreHorizontal,
  Check,
  Copy,
  ExternalLink,
  Link2,
  FilePlus2,
  FileText,
  FolderOpen,
  Info,
  Layers2,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  getPaperUrl,
  listPapers,
  uploadPaper,
  importPaperFromUrl,
  retryPaperProcessing,
} from './api'
import type { Paper, PaperResult } from './api'
import { linkCitations, parseMessageAnswer } from './answer'
import type { Citation } from './answer'
import { usePaperPreview } from './usePaperPreview'
import { SourcePreview } from './SourcePreview'
import { ResearchPanels } from './ResearchPanels'
import { useConversations } from './useConversations'
import type { User } from './auth'
import type { ChatMessage } from './conversations'

type View = 'Chat' | 'My Papers' | 'Shared' | 'Settings'
type Message = ChatMessage
type BusyAction = 'upload' | 'import' | 'answer' | 'conversation' | 'retry'


function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    if (value === null || typeof value !== typeof fallback) return fallback
    if (Array.isArray(fallback) && !Array.isArray(value)) return fallback
    return value
  } catch {
    return fallback
  }
}

function saveStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function uniquePapers(papers: Paper[]) {
  return [...new Map(papers.map((paper) => [paper.paper_id, paper])).values()]
}

function paperStatus(status: string) {
  const labels: Record<string, string> = {
    ready: 'Ready to explore',
    failed: 'Processing failed',
    processing: 'Processing',
    uploaded: 'Uploaded',
    parsing: 'Reading PDF',
    embedding: 'Preparing evidence',
    queued: 'Waiting to process',
  }
  return labels[status] || status
}

const title = (name: string) => name.replace(/\.pdf$/i, '').replace(/_/g, ' ')

function MarkdownAnswer({
  text,
  citations,
  onCitation,
}: {
  text: string
  citations: Citation[]
  onCitation: (citation: Citation) => void
}) {
  return (
    <div className="answer-text answer-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        disallowedElements={['img']}
        components={{
          a: ({ href, children }) => {
            const sourceId = href?.match(/^#source-(\d+)$/)
            const citation = sourceId
              ? citations.find((item) => item.id === Number(sourceId[1]))
              : undefined
            if (citation)
              return (
                <button className="citation-link" onClick={() => onCitation(citation)}>
                  [{children}]
                </button>
              )
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {linkCitations(text, citations)}
      </ReactMarkdown>
    </div>
  )
}

export default function App({
  user,
  onLogout,
  loggingOut,
}: {
  user: User
  onLogout: () => Promise<void>
  loggingOut: boolean
}) {
  const [view, setView] = useState<View>('Chat')
  const [researchTab, setResearchTab] = useState<'chat' | 'takeaways' | 'references'>('chat')
  const [collections, setCollections] = useState<{id:string; name:string; papers:string[]}[]>(() => readStorage(`paperpilot:collections:${user.id}`, []).filter((item: unknown): item is {id:string; name:string; papers:string[]} => !!item && typeof item === 'object' && typeof (item as {id?:unknown}).id === 'string' && typeof (item as {name?:unknown}).name === 'string' && Array.isArray((item as {papers?:unknown}).papers)))
  const [collectionFilter, setCollectionFilter] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [addingCollection, setAddingCollection] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importDraft, setImportDraft] = useState('')
  const [importError, setImportError] = useState('')
  const userId = user.id
  const [papers, setPapers] = useState<Paper[]>([])
  const [selected, setSelected] = useState('')
  const [page, setPage] = useState(1)
  const [showSource, setShowSource] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [question, setQuestion] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState<{ message: ChatMessage; previousIds: string[] } | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [error, setError] = useState('')
  const [libraryError, setLibraryError] = useState(false)
  const [notice, setNotice] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState('')
  const [retry, setRetry] = useState(0)
  const [retryingPaperId, setRetryingPaperId] = useState('')

  const settingsHeading = useRef<HTMLHeadingElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const localPdfInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const modalInput = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const currentWorkspace = useRef(userId)
  const operation = useRef<AbortController | null>(null)
  const libraryRequest = useRef<AbortController | null>(null)
  const libraryVersion = useRef(0)
  const recentPaper = useRef<Paper | null>(null)
  const copyTimer = useRef<number | undefined>(undefined)

  const chat = useConversations(userId, setSelected)
  const selectedConversation = chat.conversations.find((item) => item.id === chat.selected)
  const activePaperId = chat.selected ? selectedConversation?.paper_id : selected
  const active = papers.find((paper) => paper.paper_id === activePaperId)
  // Show the submitted question through chat creation and generation. Once the
  // server returns its saved user message, render that record instead.
  const questionSaved = pendingQuestion && chat.messages.some(message =>
    message.role === 'user' && message.content === pendingQuestion.message.content &&
    !pendingQuestion.previousIds.includes(message.id),
  )
  const currentMessages = pendingQuestion && !questionSaved
    ? [...chat.messages, pendingQuestion.message]
    : chat.messages
  const chatBusy = !!busy || chat.working || chat.loading
  const {
    pdf: currentPdf,
    attachPdf,
    loading: previewLoading,
    warning: previewWarning,
    retry: retryPreview,
  } = usePaperPreview(userId, active?.paper_id || '', active?.filename || '')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current?.abort()
      libraryRequest.current?.abort()
      clearTimeout(copyTimer.current)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    libraryRequest.current?.abort()
    libraryRequest.current = controller
    const version = ++libraryVersion.current
    setLoading(true)
    setLibraryError(false)

    listPapers(controller.signal)
      .then((data) => {
        if (controller.signal.aborted || version !== libraryVersion.current) return
        let library = uniquePapers(data.papers)
        // Keep a successful import visible if a list response has not caught up yet.
        if (
          recentPaper.current &&
          !library.some((paper) => paper.paper_id === recentPaper.current?.paper_id)
        ) {
          library = [recentPaper.current, ...library]
        } else {
          recentPaper.current = null
        }
        setPapers(library)
        const savedSelection = readStorage(`paperpilot:selected:${userId}`, '')
        setSelected((previous) => {
          if (library.some((paper) => paper.paper_id === previous)) return previous
          if (library.some((paper) => paper.paper_id === savedSelection)) return savedSelection
          return (
            library.find((paper) => paper.status === 'ready')?.paper_id ||
            library[0]?.paper_id ||
            ''
          )
        })
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted && version === libraryVersion.current) {
          setError(err.message)
          setLibraryError(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && version === libraryVersion.current) setLoading(false)
      })
    return () => controller.abort()
  }, [userId, retry])

  useEffect(() => {
    if (active) saveStorage(`paperpilot:selected:${userId}`, active.paper_id)
  }, [active, userId])

  useEffect(() => {
    if (busy || !papers.some((paper) => !['ready', 'failed'].includes(paper.status))) return
    const timer = window.setInterval(() => setRetry((value) => value + 1), 5000)
    return () => clearInterval(timer)
  }, [papers, busy])

  useEffect(() => {
    const conversation = bottom.current?.parentElement
    conversation?.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' })
  }, [currentMessages, busy, chat.selected])

  useEffect(() => {
    if (!uploadOpen) return
    const previousFocus = document.activeElement as HTMLElement | null
    modalInput.current?.focus()
    return () => previousFocus?.focus()
  }, [uploadOpen])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  function storeCollections(next: typeof collections) {
    if (!saveStorage(`paperpilot:collections:${userId}`, next)) { setError('Could not save collections in this browser.'); return false }
    setCollections(next)
    return true
  }

  useEffect(() => {
    if (view === 'Settings') settingsHeading.current?.focus()
  }, [view])

  function navigate(next: View) {
    if (next === 'Chat') setResearchTab('chat')
    setView(next)
    setMobileNav(false)
  }

  function choosePaper(paper: Paper) {
    setResearchTab('chat')
    if (operation.current || chat.working || chat.loading) return
    chat.clearSelection()
    setSelected(paper.paper_id)
    setPage(1)
    setView('Chat')
    setQuestion('')
    setError('')
    setLibraryError(false)
    setShowSource(true)
  }

  // A ref locks submissions immediately, before React renders the disabled button.
  function beginOperation(action: BusyAction) {
    if (operation.current) return null
    const controller = new AbortController()
    operation.current = controller
    libraryRequest.current?.abort()
    libraryVersion.current += 1
    setLoading(false)
    setBusy(action)
    setError('')
    setLibraryError(false)
    return controller
  }

  function isCurrentRequest(controller: AbortController) {
    return (
      mounted.current &&
      !controller.signal.aborted &&
      operation.current === controller &&
      currentWorkspace.current === userId
    )
  }

  function finishOperation(controller: AbortController) {
    if (!isCurrentRequest(controller)) return
    operation.current = null
    setBusy(null)
  }

  async function retryProcessing(paper: Paper) {
    if (paper.status !== 'failed' || chat.working || chat.loading) return
    const controller = beginOperation('retry')
    if (!controller) return
    setRetryingPaperId(paper.paper_id)
    try {
      await retryPaperProcessing(paper.paper_id, controller.signal)
      if (!isCurrentRequest(controller)) return
      // Update the same paper; existing polling follows its processing status.
      setPapers((previous) =>
        previous.map((item) =>
          item.paper_id === paper.paper_id ? { ...item, status: 'processing' } : item,
        ),
      )
      if (recentPaper.current?.paper_id === paper.paper_id) {
        recentPaper.current = { ...recentPaper.current, status: 'processing' }
      }
      setNotice(`Processing queued again for ${title(paper.filename)}.`)
    } catch (error) {
      if (isCurrentRequest(controller)) {
        setError(`Could not retry ${title(paper.filename)}: ${(error as Error).message}`)
      }
    } finally {
      if (isCurrentRequest(controller)) setRetryingPaperId('')
      finishOperation(controller)
    }
  }

  function addAndSelectPaper(result: PaperResult) {
    if (
      !result ||
      typeof result.paper_id !== 'string' ||
      !result.paper_id ||
      typeof result.filename !== 'string' ||
      !result.filename
    )
      throw new Error(
        'The API did not return a paper ID and filename. Refresh My Papers before trying again.',
      )
    const paper: Paper = {
      ...result,
      // Upload/import now queues background processing. Only the server can mark it ready.
      status: result.status || 'processing',
      created_at: result.created_at || new Date().toISOString(),
    }
    recentPaper.current = paper
    setPapers((previous) =>
      uniquePapers([paper, ...previous.filter((item) => item.paper_id !== paper.paper_id)]),
    )
    chat.clearSelection()
    setSelected(paper.paper_id)
    setPage(1)
    setView('Chat')
    setShowSource(true)
    setSearch('')
    setRetry((value) => value + 1)
    return paper
  }

  async function attachLocalPdf(file?: File) {
    if (!file || !selected) return
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      setError('Please choose a PDF file.')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('Choose a PDF under 50 MB to save its preview.')
      return
    }
    const workspace = userId
    setPage(1)
    setShowSource(true)
    const saved = await attachPdf(selected, file)
    if (!mounted.current || currentWorkspace.current !== workspace) return
    setNotice(
      saved
        ? 'PDF preview saved. It will open automatically when you select this paper.'
        : 'PDF attached for this session. Browser storage is unavailable.',
    )
  }

  async function upload(file?: File) {
    if (!file || operation.current) return
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      setError('Choose a PDF file to add to your library.')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('This file is too large. Choose a PDF under 50 MB.')
      return
    }
    const controller = beginOperation('upload')
    if (!controller) return
    setUploadOpen(false)
    try {
      const result = await uploadPaper(file, controller.signal)
      if (!isCurrentRequest(controller)) return
      const saved = await attachPdf(result.paper_id, file)
      if (!isCurrentRequest(controller)) return
      const paper = addAndSelectPaper(result)
      setNotice(
        paper.status === 'ready'
          ? saved
            ? 'Your paper is ready to explore. Its preview is saved in this browser.'
            : 'Your paper is ready. Local preview storage is unavailable.'
          : `Paper uploaded. ${paperStatus(paper.status)}.`,
      )
    } catch (err) {
      if (isCurrentRequest(controller)) setError((err as Error).message)
    } finally {
      finishOperation(controller)
    }
  }

  async function importUrl(url: string, originalInput: string) {
    setResearchTab('chat')
    const controller = beginOperation('import')
    if (!controller) return
    setQuestion('')
    setView('Chat')
    try {
      const result = await importPaperFromUrl(url, controller.signal)
      if (!isCurrentRequest(controller)) return
      const paper = addAndSelectPaper(result)
      setNotice(
        paper.status === 'ready'
          ? `Imported ${paper.filename}. Ready for questions.`
          : `Imported ${paper.filename}. ${paperStatus(paper.status)}.`,
      )
    } catch (err) {
      if (isCurrentRequest(controller)) {
        setError((err as Error).message)
        setQuestion(originalInput)
      }
    } finally {
      finishOperation(controller)
    }
  }

  async function ask(value = question) {
    setResearchTab('chat')
    const text = value.trim()
    if (!text || operation.current || chat.working) return

    const url = getPaperUrl(text)
    if (url) {
      await importUrl(url, value)
      return
    }
    if (/^(?:https?:\/\/|www\.)\S*$/i.test(text)) {
      setError(
        'Paste a complete arXiv abstract/PDF link or a direct PDF URL. Query parameters are supported.',
      )
      return
    }
    // A paper import does not depend on loading/recovering the current chat.
    // Questions still wait for persisted history before another message is sent.
    if (chat.loading) {
      setError('Your chat history is still loading. Please try your question again shortly.')
      return
    }
    if (chat.needsRecovery) {
      setError(
        'Reload saved messages before sending another question. You can still import a paper URL.',
      )
      return
    }
    if (!active || active.status !== 'ready') {
      setError(
        active
          ? 'This paper is not ready for questions. You can still paste another paper URL.'
          : 'Upload a PDF or paste a paper URL before asking questions.',
      )
      return
    }

    const controller = beginOperation('answer')
    if (!controller) return
    setPendingQuestion({
      message: { id: `pending-${crypto.randomUUID()}`, conversation_id: chat.selected || '', role: 'user', content: text, sources: null, created_at: new Date().toISOString() },
      previousIds: chat.messages.map(message => message.id),
    })
    setQuestion('')
    setView('Chat')
    try {
      const conversationId =
        chat.selected || (await chat.newChat(active.paper_id, controller.signal))
      if (!conversationId || !isCurrentRequest(controller)) return
      await chat.send(conversationId, text, controller.signal)
    } catch (err) {
      if (isCurrentRequest(controller)) {
        setError(
          `${(err as Error).message} Saved messages have been reloaded where available. Check the conversation before sending again.`,
        )
        // Leave the draft available, but never automatically resend a saved question.
        setQuestion(text)
      }
    } finally {
      if (isCurrentRequest(controller)) setPendingQuestion(null)
      finishOperation(controller)
    }
  }

  function openCitation(citation: Citation) {
    setResearchTab('chat')
    setShowSource(true)
    if (citation.page) setPage(citation.page)
    else setNotice('This source has no page number in the API response.')
  }

  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content)
      if (!mounted.current) return
      setCopied(message.id)
      clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(''), 2000)
    } catch {
      if (mounted.current)
        setError('Clipboard access is unavailable. You can select and copy the answer text.')
    }
  }
  async function newChat() {
    if (operation.current || chat.working || chat.loading) return
    chat.clearSelection()
    setQuestion('')
    setError('')
    setPage(1)
    setShowSource(false)
    navigate('Chat')
  }

  function openChat(id: string) {
    setResearchTab('chat')
    if (operation.current) return
    setQuestion('')
    setError('')
    setPage(1)
    setShowSource(true)
    navigate('Chat')
    void chat.openConversation(id)
  }
  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (!event.repeat) event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`} aria-label="Main navigation">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            navigate('Chat')
          }}
        >
          <svg className="brand-mark" width="31" height="31" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 5C9 4 13 7 14 11V28C11 22 6 22 2 21V6L3 5Z" fill="#83B78B"/><path d="M18 8C21 3 27 2 30 3V17C24 17 20 20 17 26V12L18 8Z" fill="#246B4E"/><path d="M6 10C10 11 13 14 14 19M27 9C23 10 20 13 18 18" stroke="#F5FCF6" strokeWidth="2" strokeLinecap="round"/></svg>
          <span>
            PaperPilot AI<small>Your Research Workspace</small>
          </span>
        </a>

        <button className="new-chat text-button" onClick={() => void newChat()} disabled={chatBusy}><Plus size={15} />New Chat</button>
        <nav className="sidebar-library-nav" aria-label="Paper library navigation">
          <button aria-label={`My Papers ${papers.length}`} className={`nav-item ${view === 'My Papers' ? 'active' : ''}`} aria-current={view === 'My Papers' ? 'page' : undefined} onClick={() => { setCollectionFilter(''); navigate('My Papers') }}><FileText size={19} strokeWidth={1.7}/><span>Paper Library</span>{papers.length > 0 && <span className="nav-count">{papers.length}</span>}</button>
        </nav>
        <section className="collections" aria-label="Paper collections">
          <div className="collection-heading"><span><Folder size={17} />Collections</span><button className="icon-button" aria-label="Create collection" onClick={() => setAddingCollection(v => !v)}><Plus size={14} /></button></div>
          {collections.map(collection => <button key={collection.id} className={`collection-item ${collectionFilter === collection.id ? 'active' : ''}`} onClick={() => { navigate('My Papers'); setCollectionFilter(collectionFilter === collection.id ? '' : collection.id); }}><Folder size={16} /><span>{collection.name}</span><small>{collection.papers.filter(id => papers.some(p => p.paper_id === id)).length}</small></button>)}
          {collections.length === 0 && !addingCollection && <button className="collection-create" onClick={() => setAddingCollection(true)}><Plus size={14} />Create your first collection</button>}
          {addingCollection && <form className="collection-form" onSubmit={(e) => { e.preventDefault(); if (!collectionName.trim()) return; if(storeCollections([...collections,{id:crypto.randomUUID(),name:collectionName.trim(),papers:[]}])) { setCollectionName(''); setAddingCollection(false) } }}><input autoFocus aria-label="Collection name" placeholder="Collection name" maxLength={60} value={collectionName} onChange={e => setCollectionName(e.target.value)} /><button aria-label="Save collection" disabled={!collectionName.trim()}><Check size={16}/></button></form>}
          <small className="collection-local">Saved in this browser</small>
        </section>
        <section className="chat-history" aria-label="Conversation history">
          <p className="nav-label">YOUR CHATS</p>
          {chat.loading && <p className="history-status">Loading conversations...</p>}
          {!chat.loading && chat.conversations.length === 0 && (
            <p className="history-status">Your saved chats will appear here.</p>
          )}
          {chat.error && (
            <div className="history-status" role="alert">
              {chat.error}
              <button
                className="text-button"
                disabled={chatBusy}
                onClick={() => void chat.reload()}
              >
                Reload chats
              </button>
            </div>
          )}
          {chat.conversations.map((conversation) => (
            <div
              className={`history-row ${chat.selected === conversation.id ? 'active' : ''}`}
              key={conversation.id}
            >
              <button
                className="history-select"
                disabled={chatBusy}
                aria-current={chat.selected === conversation.id ? 'true' : undefined}
                onClick={() => openChat(conversation.id)}
              >
                <MessageCircle size={15} />
                <span>{conversation.title}</span>
              </button>
              <button
                className="icon-button"
                aria-label={`Delete conversation ${conversation.title}`}
                disabled={chatBusy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${conversation.title}" and its messages? This cannot be undone.`,
                    )
                  )
                    void chat.remove(conversation.id)
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </section>
<button className={`nav-item shared-navigation ${view === 'Shared' ? 'active' : ''}`} onClick={() => navigate('Shared')}><Users size={17}/><span>Shared with Me</span></button>
        <div className="sidebar-import">
          <p className="nav-label">IMPORT PAPERS</p>
          <button className="primary" disabled={chatBusy} onClick={() => setUploadOpen(true)}><Upload size={17} />Upload PDF</button>
          <button className="secondary" disabled={chatBusy} onClick={() => { setImportError(''); setImportOpen(true) }}><Link2 size={16} />Import arXiv URL</button>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <BookOpen size={20} />
            <strong>Your research workspace</strong>
            <p>
              Your papers. Your questions.
              <br />
              Every answer, grounded.
            </p>
          </div>
          <button className="profile" aria-label="Open account settings" aria-current={view === 'Settings' ? 'page' : undefined} onClick={() => navigate('Settings')}>
            <span className="avatar">{user.email.charAt(0).toUpperCase()}</span>
            <span>
              <strong>{user.email}</strong>
              <small>Personal Research Workspace</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>

      <main id="main-content" className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <strong className="workspace-title">{view === 'Settings' ? 'Settings' : 'Your Research Workspace'}</strong>
          </div>
          <label className="global-search"><Search size={17} /><input aria-label="Search workspace papers" placeholder="Search your papers…" value={search} onChange={(event) => { setSearch(event.target.value); if (view === 'Chat') navigate('My Papers') }} /></label>
          <div className="top-actions"><details className="activity-menu"><summary aria-label="Paper activity" title="Paper activity"><Bell size={18}/></summary><div><strong>Paper activity</strong><p>{papers.filter(p => !['ready','failed'].includes(p.status)).length} papers processing</p><p>{papers.filter(p => p.status === 'ready').length} papers ready to explore</p><p>{papers.filter(p => p.status === 'failed').length} papers need attention</p><button onClick={(event) => { const menu = event.currentTarget.closest('details'); if (menu) menu.open = false; setCollectionFilter(''); navigate('My Papers') }}>View paper library <ArrowRight size={14}/></button></div></details><span className="top-avatar" aria-label={`Signed in as ${user.email}`} title={user.email}>{user.email.charAt(0).toUpperCase()}</span>
            <button
              className="secondary auth-entry-link"
              onClick={() => void onLogout()}
              disabled={loggingOut}
              aria-label="Log out of PaperPilot"
            >
              <LogOut size={16} />
              <span>{loggingOut ? 'Logging out...' : 'Log out'}</span>
            </button>
            <span className="private-label">
              <span className="status-dot" />
              Personal workspace
            </span>
            <button className="secondary" disabled={chatBusy} onClick={() => setUploadOpen(true)}>
              <Upload size={16} /> <span>Upload paper</span>
            </button>
          </div>
        </header>
        <div className="workspace-layout">
          <div className="workspace-stage">
        <div className="content">
          {error && (
            <div role="alert" className="banner error">
              <Info size={18} />
              <span>{error}</span>
              <>
                {libraryError && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setRetry((v) => v + 1)
                      setError('')
                    }}
                  >
                    Retry connection
                  </button>
                )}
              </>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {(busy === 'upload' || busy === 'import') && (
            <div className="banner" role="status">
              <LoaderCircle className="spin" size={18} />
              <span>
                {busy === 'import'
                  ? 'Importing your paper from its URL...'
                  : 'Uploading your paper to your library...'}
              </span>
            </div>
          )}

          {view === 'Chat' && (
            <>
              <div className="paper-bar">
                <div className="paper-file">
                  <FileText size={23} />
                </div>
                <div className="paper-title">
                  <span className="eyebrow">ACTIVE PAPER</span>
                  <h1>{active ? title(active.filename) : 'Your next discovery starts here'}</h1>
                  <p>
                    {active ? (
                      <>
                        <span
                          className={`status-dot ${active.status === 'failed' ? 'failed' : active.status !== 'ready' ? 'pending' : ''}`}
                        />
                        {paperStatus(active.status)}
                        <span className="dot-separator">·</span>PDF document
                      </>
                    ) : (
                      'A calmer space to make sense of your research.'
                    )}
                  </p>
                </div>
                <div className="paper-controls">
                  <details className="paper-menu"><summary aria-label="Paper actions" title="Paper actions"><MoreHorizontal size={19}/></summary><div><button disabled={!active || chatBusy} onClick={() => void newChat()}><Plus size={15}/>New chat with paper</button><button onClick={() => navigate('My Papers')}><FolderOpen size={15}/>Open paper library</button>{active && <label>Organize paper<select aria-label="Add paper to collection" value="" onChange={e => { const id=e.target.value; if(!id || !active)return; storeCollections(collections.map(c => c.id === id ? {...c,papers:c.papers.includes(active.paper_id) ? c.papers.filter(p => p!==active.paper_id) : [...c.papers,active.paper_id]} : c)) }}><option value="">Choose collection…</option>{collections.map(c => <option key={c.id} value={c.id}>{c.papers.includes(active.paper_id) ? 'Remove from' : 'Add to'} {c.name}</option>)}</select></label>}</div></details>
                  {currentPdf && <><a className="icon-button" href={currentPdf.url} target="_blank" rel="noopener noreferrer" aria-label="Open paper in new tab" title="Open paper in new tab"><ExternalLink size={18} /></a><a className="icon-button" href={currentPdf.url} download={currentPdf.name} aria-label="Download paper" title="Download paper"><ArrowDownToLine size={18} /></a></>}
                  {papers.length > 0 && (
                    <select
                      aria-label="Select active paper"
                      disabled={chatBusy}
                      value={selected}
                      onChange={(event) => {
                        const paper = papers.find((p) => p.paper_id === event.target.value)
                        if (paper) choosePaper(paper)
                      }}
                    >
                      {papers.map((p) => (
                        <option key={p.paper_id} value={p.paper_id}>
                          {title(p.filename)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="icon-button source-toggle"
                    aria-label={showSource ? 'Hide source preview' : 'Show source preview'}
                    onClick={() => setShowSource((v) => !v)}
                  >
                    {showSource ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
                  </button>
                </div>
              </div>
              <nav className="research-tabs" aria-label="Paper tools">
                <button className={researchTab === 'chat' ? 'active' : ''} aria-pressed={researchTab === 'chat'} onClick={() => setResearchTab('chat')}><MessageCircle size={17} />Chat with Paper</button>
                {currentPdf ? <a href={currentPdf.url} target="_blank" rel="noopener noreferrer"><FileText size={17} />Paper View<ExternalLink size={12} /></a> : <button disabled={!active || previewLoading} onClick={() => { setShowSource(true); setResearchTab('chat'); setNotice('Attach the matching PDF in Source preview to open this paper.'); }}><FileText size={17} />{previewLoading ? 'Loading PDF…' : 'Paper View'}</button>}
                <button className={researchTab === 'takeaways' ? 'active' : ''} aria-pressed={researchTab === 'takeaways'} onClick={() => setResearchTab('takeaways')}><Sparkles size={17} />Key Takeaways</button>
                <button className={researchTab === 'references' ? 'active' : ''} aria-pressed={researchTab === 'references'} onClick={() => setResearchTab('references')}><Link2 size={17} />References</button>
              </nav>
              {researchTab !== 'chat' && <ResearchPanels tab={researchTab} messages={currentMessages} paperTitle={active ? title(active.filename) : ''} ready={active?.status === 'ready' && !chatBusy} onAsk={(prompt) => void ask(prompt)} onCitation={openCitation} />}
              <div style={researchTab !== 'chat' ? { display: 'none' } : undefined} className={`research-grid ${showSource ? '' : 'without-source'}`}>
                <section className="chat-column" aria-label="Paper chat">
                  <div className="chat-card">
                    <div className="chat-heading">
                      <div>
                        <h2>
                          Explore your paper<span className="teal-dot">.</span>
                        </h2>
                        <p>Ask questions. Follow the evidence.</p>
                      </div>
                      <span className="outline-badge">
                        <Sparkles size={12} /> Research assistant
                      </span>
                    </div>
                    <div className="conversation" aria-live="polite" aria-busy={busy === 'answer'}>
                      {chat.working && (
                        <p className="history-status" role="status">
                          Loading conversation...
                        </p>
                      )}
                      {chat.needsRecovery && !chat.working && (
                        <div className="info-box">
                          <p>Reload saved messages before continuing this chat.</p>
                          <button
                            className="text-button"
                            disabled={chatBusy}
                            onClick={() => void chat.reload()}
                          >
                            Reload conversation
                          </button>
                        </div>
                      )}
                      {!chat.working && !chat.needsRecovery && currentMessages.length === 0 && (
                        <div className="chat-welcome">
                          <div className="welcome-symbol">
                            <BookOpen size={29} strokeWidth={1.4} />
                          </div>
                          <span className="eyebrow">LESS SEARCHING. MORE UNDERSTANDING.</span>
                          <h3>
                            {active
                              ? 'What would you like to discover?'
                              : 'Big ideas begin with a paper.'}
                          </h3>
                          <p>
                            {active
                              ? 'From the main idea to the finer details, explore answers drawn from your selected paper.'
                              : 'Upload a PDF or paste an arXiv or PDF link below, then explore answers grounded in the paper.'}
                          </p>
                          {!active ? (
                            <button
                              className="primary"
                              disabled={chatBusy}
                              onClick={() => setUploadOpen(true)}
                            >
                              <Plus size={17} />
                              Add your first paper
                            </button>
                          ) : (
                            <div className="suggestions">
                              {[
                                'What is this paper about?',
                                'Explain the main method',
                                'What are the key findings?',
                              ].map((prompt, i) => (
                                <button
                                  key={prompt}
                                  onClick={() => void ask(prompt)}
                                  disabled={chatBusy || active.status !== 'ready'}
                                >
                                  {i === 0 ? (
                                    <BookOpen size={17} />
                                  ) : i === 1 ? (
                                    <Layers2 size={17} />
                                  ) : (
                                    <Sparkles size={17} />
                                  )}
                                  <span>{prompt}</span>
                                  <ArrowUp size={15} />
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="grounded-caption">
                            <span className="status-dot" />
                            Built around evidence, not guesswork
                          </div>
                        </div>
                      )}
                      {currentMessages.map((message) => {
                        if (message.role === 'user')
                          return (
                            <div className="user-message" key={message.id}>
                              <div>
                                <p>{message.content}</p>
                              </div>
                              <span className="avatar small">
                                {user.email.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )
                        const answer = parseMessageAnswer(message.content, message.sources)
                        return (
                          <article className="assistant-message" key={message.id}>
                            <div className="assistant-avatar">
                              <BookOpen size={19} />
                            </div>
                            <div className="answer-content">
                              <div className="answer-byline">
                                <Check size={13} />{answer.citations.length ? 'Answer with sources' : 'Answer from your paper'}
                              </div>
                              <div className="answer-prose"><MarkdownAnswer
                                text={answer.text}
                                citations={answer.citations}
                                onCitation={openCitation}
                              /></div>
                              {answer.citations.length > 0 && (
                                <div className="sources">
                                  <h4>
                                    <Layers2 size={15} />Sources in this answer <span>{answer.citations.length}</span>
                                  </h4>
                                  {answer.citations.map((citation, index) => (
                                    <button
                                      key={`${citation.section}-${index}`}
                                      className="source-card"
                                      onClick={() => openCitation(citation)}
                                    >
                                      <FileText size={20} />
                                      <div>
                                        <strong>
                                          <span>[{citation.id ?? index + 1}]</span>{' '}
                                          {citation.section}{' '}
                                          <span className="source-page">
                                            {citation.page
                                              ? `· Page ${citation.pages}`
                                              : '· Page unavailable'}
                                          </span>
                                        </strong>
                                        <small>
                                          {active ? title(active.filename) : 'Selected paper'}
                                        </small>
                                      </div>
                                      <ArrowRight size={16} />
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="answer-footer">
                                {answer.confidence && (
                                  <span>
                                    <span className="status-dot" />
                                    Evidence confidence <strong>{answer.confidence}</strong>
                                    <Info
                                      size={13}
                                      aria-label="Backend evidence support estimate"
                                    />
                                  </span>
                                )}
                                <div>
                                  <button
                                    className="icon-button"
                                    aria-label="Copy answer"
                                    title="Copy answer"
                                    onClick={() => void copy(message)}
                                  >
                                    {copied === message.id ? (
                                      <Check size={16} />
                                    ) : (
                                      <Copy size={16} />
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </article>
                        )
                      })}
                      {busy === 'answer' && (
                        <div className="thinking">
                          <div className="assistant-avatar">
                            <BookOpen size={19} />
                          </div>
                          <LoaderCircle size={16} className="spin" />
                          <span>Finding the evidence in your paper…</span>
                        </div>
                      )}
                      <div ref={bottom} />
                    </div>
                  </div>
                  <form
                    className="composer"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const text = new FormData(event.currentTarget).get('question')
                      void ask(typeof text === 'string' ? text : question)
                    }}
                  >
                    <div className="composer-input">
                      <textarea
                        name="question"
                        aria-label="Question about your paper"
                        placeholder={
                          active?.status === 'ready'
                            ? 'Ask a question about this paper, or paste a paper URL…'
                            : 'Paste an arXiv or PDF URL to import a paper…'
                        }
                        rows={1}
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        onKeyDown={composerKey}
                        disabled={chatBusy}
                      />
                      <button
                        className="primary send-button"
                        type="submit"
                        aria-label="Send message"
                        disabled={!question.trim() || chatBusy}
                      >
                        {busy ? <LoaderCircle className="spin" size={19} /> : <Send size={20} />}
                      </button>
                    </div>
                    <div className="composer-caption">
                      <span>
                        <span className="status-dot" />
                        {getPaperUrl(question)
                          ? 'Send to import this paper'
                          : active
                            ? 'Answers grounded in your selected paper'
                            : 'Paste a paper link, or upload a PDF'}
                      </span>
                      <span>↵ send · Shift+↵ new line</span>
                    </div>
                  </form>
                </section>
                {showSource && (
                  <SourcePreview
                    pdf={currentPdf}
                    page={page}
                    loading={previewLoading}
                    warning={previewWarning}
                    hasPaper={!!active}
                    onPageChange={setPage}
                    onAttach={() => localPdfInput.current?.click()}
                    onRetry={retryPreview}
                  />
                )}
              </div>
            </>
          )}

          {view === 'Shared' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">RESEARCH, TOGETHER</span><h1>Shared with Me</h1><p>A place for papers shared by your research collaborators.</p></div></div><div className="feature-card"><div className="feature-icon"><Users size={28}/></div><h2>Your next collaboration starts here.</h2><p>Shared libraries will appear here when paper sharing is available. Your personal papers remain in your library.</p><span className="outline-badge">Sharing coming soon</span><button className="secondary" onClick={() => navigate('My Papers')}><FolderOpen size={16}/>Explore your paper library</button></div></section>}
          {view === 'My Papers' && (
            <section className="page-section">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR RESEARCH, TOGETHER</span>
                  <h1>
                    My Papers<span className="teal-dot">.</span>
                  </h1>
                  <p>A home for the ideas you’re exploring.</p>
                </div>
                <button className="primary" disabled={chatBusy} onClick={() => setUploadOpen(true)}>
                  <Plus size={17} />
                  Add paper
                </button>
              </div>
              <div className="library-toolbar">
                <label className="search-box">
                  <Search size={18} />
                  <input
                    placeholder="Search your papers…"
                    aria-label="Search papers"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  onClick={() => setRetry((v) => v + 1)}
                  disabled={loading || chatBusy}
                >
                  <RefreshCw size={15} className={loading ? 'spin' : ''} />
                  Refresh
                </button>
              </div>
              {loading && papers.length === 0 ? (
                <div className="empty-state">
                  <LoaderCircle className="spin" />
                  <p>Opening your library…</p>
                </div>
              ) : papers.length === 0 ? (
                <div className="empty-state">
                  <FolderOpen size={36} strokeWidth={1.3} />
                  <h2>Your library is a blank page.</h2>
                  <p>Add your first research paper and give your curiosity a place to land.</p>
                  <button
                    className="primary"
                    disabled={chatBusy}
                    onClick={() => setUploadOpen(true)}
                  >
                    <Plus size={17} />
                    Upload a PDF
                  </button>
                </div>
              ) : (
                <div className="paper-list">
                  {papers
                    .filter((p) => (!collectionFilter || collections.find(c => c.id === collectionFilter)?.papers.includes(p.paper_id)) && p.filename.toLowerCase().includes(search.toLowerCase()))
                    .map((paper) => (
                      <div className="library-paper-row" key={paper.paper_id}>
                        <button
                          className={`library-paper ${selected === paper.paper_id ? 'selected' : ''}`}
                          aria-pressed={selected === paper.paper_id}
                          disabled={chatBusy}
                          onClick={() => choosePaper(paper)}
                        >
                          <div className="paper-file">
                            <FileText size={23} />
                          </div>
                          <div>
                            <h3>{title(paper.filename)}</h3>
                            <p>
                              PDF document{' '}
                              {paper.created_at && (
                                <>
                                  · Added{' '}
                                  {new Date(
                                    paper.created_at.includes('T')
                                      ? paper.created_at
                                      : paper.created_at.replace(' ', 'T') + 'Z',
                                  ).toLocaleDateString()}
                                </>
                              )}
                            </p>
                          </div>
                          <span className={`paper-status ${paper.status}`}>
                            <span className="status-dot" />
                            {paperStatus(paper.status)}
                          </span>
                          <ArrowRight size={19} />
                        </button>
                        {paper.status === 'failed' && (
                          <button
                            type="button"
                            className="secondary paper-retry"
                            disabled={chatBusy}
                            aria-busy={retryingPaperId === paper.paper_id}
                            onClick={() => void retryProcessing(paper)}
                          >
                            {retryingPaperId === paper.paper_id ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <RefreshCw size={15} />
                            )}
                            {retryingPaperId === paper.paper_id
                              ? 'Retrying...'
                              : 'Retry Processing'}
                          </button>
                        )}
                      </div>
                    ))}
                  {papers.length > 0 &&
                    !papers.some((p) =>
                      p.filename.toLowerCase().includes(search.toLowerCase()),
                    ) && (
                      <div className="empty-state">
                        <Search size={30} />
                        <h2>No matching papers</h2>
                        <p>Try another title or clear your search.</p>
                      </div>
                    )}
                </div>
              )}
            </section>
          )}

          {view === 'Settings' && (
        <section className="account-settings account-settings-page page-section" aria-labelledby="account-settings-title">
          <header><div><span className="eyebrow">YOUR WORKSPACE</span><h1 id="account-settings-title" ref={settingsHeading} tabIndex={-1}>Account settings</h1></div><Settings2 size={24} /></header>
          <div className="account-identity"><span className="avatar">{user.email.charAt(0).toUpperCase()}</span><div><strong>Personal Research Workspace</strong><p>Your signed-in PaperPilot account</p></div></div>
          <label className="field-label">Account email<input value={user.email} readOnly /></label>
          <div className="account-storage"><h3>Workspace & storage</h3><p>Your papers and chat history belong to this account. Collections and saved PDF copies are stored in this browser.</p></div>
          <footer><button className="secondary" onClick={() => navigate('Chat')}>Back to research</button><button className="primary" disabled={loggingOut} onClick={() => void onLogout()}><LogOut size={16}/>{loggingOut ? 'Logging out…' : 'Log out'}</button></footer>
        </section>
          )}
          <footer className="workspace-footer">
            <span>PaperPilot</span>
            <span>A little more clarity. A lot more possibility.</span>
            <span>
              Made for curious minds
              <Send size={12} />
            </span>
          </footer>
        </div>
          </div>
        </div>
      </main>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Upload a research PDF"
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <input
        ref={localPdfInput}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Attach a local PDF for preview"
        onChange={(event) => {
          void attachLocalPdf(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {importOpen && <div className="modal-backdrop" onClick={(event) => { if(event.target === event.currentTarget) setImportOpen(false) }} onKeyDown={(event) => { if(event.key === 'Escape') setImportOpen(false) }}><section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="modal-top"><span className="feature-icon"><Link2 size={25} /></span><button className="icon-button" aria-label="Close import dialog" onClick={() => setImportOpen(false)}><X size={20} /></button></div><h2 id="import-title">Bring a paper into focus.</h2><p>Paste an arXiv abstract, arXiv PDF, or direct PDF link.</p><form onSubmit={(event) => { event.preventDefault(); const url=getPaperUrl(importDraft); if(!url) { setImportError('Enter a complete arXiv or direct PDF URL.'); return } setImportOpen(false); void importUrl(url,importDraft); }}><label className="field-label">Paper URL<input autoFocus type="url" required value={importDraft} placeholder="https://arxiv.org/abs/…" onChange={(event) => { setImportDraft(event.target.value); setImportError('') }} /></label>{importError && <p role="alert" className="import-error">{importError}</p>}<button className="primary" type="submit" disabled={chatBusy || !importDraft.trim()}><Link2 size={16} />Import paper</button></form></section></div>}
      {uploadOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setUploadOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setUploadOpen(false)
          }}
        >
          <div
            className="upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                const targets = event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
                const first = targets[0]
                const last = targets[targets.length - 1]
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault()
                  last.focus()
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault()
                  first.focus()
                }
              }
            }}
          >
            <div className="modal-top">
              <span className="feature-icon">
                <Upload size={24} />
              </span>
              <button
                ref={modalInput}
                className="icon-button"
                aria-label="Close upload dialog"
                onClick={() => setUploadOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="upload-title">Bring your research in.</h2>
            <p>A paper today. A new perspective tomorrow.</p>
            <button
              className={`drop-zone ${dragging ? 'dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                void upload(event.dataTransfer.files[0])
              }}
              onClick={() => fileInput.current?.click()}
            >
              <FilePlus2 size={33} strokeWidth={1.4} />
              <strong>Drop your PDF here</strong>
              <span>
                or <b>browse files</b> to choose a paper
              </span>
              <small>PDF documents · Up to 50 MB</small>
            </button>
            <div className="upload-note">
              <Info size={15} />
              <span>Choose a PDF with selectable text. Scanned images aren’t supported.</span>
            </div>
            <button className="text-button" onClick={() => setUploadOpen(false)}>
              <ArrowLeft size={14} />
              Back to workspace
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
