import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check,
  ChevronDown, ChevronLeft, ChevronRight, Copy, FilePlus2, FileText,
  FolderOpen, Info, Layers2, LoaderCircle, Menu, MessageCircle,
  NotebookPen, PanelRightClose, PanelRightOpen, Plus, RefreshCw,
  Scale, Search, Send, Settings2, Sparkles, Trash2, Upload, X,
} from 'lucide-react'
import { askPaper, listPapers, uploadPaper } from './api'
import type { Paper } from './api'
import { parseAnswer } from './answer'

type View = 'Chat' | 'My Papers' | 'Compare' | 'Summaries' | 'Notes' | 'Settings'
type Message = { id: string; role: 'user' | 'assistant'; text: string }
type Note = { id: string; paper: string; text: string; date: string }
type Pdf = { url: string; name: string }
const navigation = [
  { label: 'My Papers', icon: FolderOpen }, { label: 'Chat', icon: MessageCircle },
  { label: 'Compare', icon: Scale }, { label: 'Summaries', icon: Layers2 },
  { label: 'Notes', icon: NotebookPen }, { label: 'Settings', icon: Settings2 },
] as const

function readStorage<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
function saveStorage(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}
const title = (name: string) => name.replace(/\.pdf$/i, '').replace(/_/g, ' ')

export default function App() {
  const [view, setView] = useState<View>('Chat')
  const [userId, setUserId] = useState(() => readStorage('paperpilot:user', 'default'))
  const [draftUserId, setDraftUserId] = useState(userId)
  const [papers, setPapers] = useState<Paper[]>([])
  const [selected, setSelected] = useState('')
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [notes, setNotes] = useState<Note[]>(() => readStorage(`paperpilot:notes:${userId}`, []))
  const [pdfs, setPdfs] = useState<Record<string, Pdf>>({})
  const [page, setPage] = useState(1)
  const [showSource, setShowSource] = useState(true)
  const [mobileNav, setMobileNav] = useState(false)
  const [question, setQuestion] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'upload' | 'answer' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState('')
  const [retry, setRetry] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const localPdfInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const modalInput = useRef<HTMLButtonElement>(null)
  const pdfUrls = useRef<string[]>([])
  const active = papers.find(p => p.paper_id === selected)
  const currentMessages = messages[selected] || []
  const currentPdf = pdfs[selected]

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    listPapers(userId, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setPapers(data.papers)
      setSelected(previous => data.papers.some(p => p.paper_id === previous) ? previous : data.papers.find(p => p.status === 'ready')?.paper_id || data.papers[0]?.paper_id || '')
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [userId, retry])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])
  useEffect(() => { if (uploadOpen) modalInput.current?.focus() }, [uploadOpen])
  useEffect(() => () => pdfUrls.current.forEach(url => URL.revokeObjectURL(url)), [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  function navigate(next: View) { setView(next); setMobileNav(false) }
  function choosePaper(paper: Paper) {
    if (busy) return
    setSelected(paper.paper_id); setPage(1); setView('Chat'); setQuestion('')
  }
  function attachPdf(paperId: string, file: File) {
    const url = URL.createObjectURL(file)
    pdfUrls.current.push(url)
    setPdfs(previous => ({ ...previous, [paperId]: { url, name: file.name } }))
  }
  async function upload(file?: File) {
    if (!file || busy) return
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      setError('Choose a PDF file to add to your library.'); return
    }
    if (file.size > 50 * 1024 * 1024) { setError('This file is too large. Choose a PDF under 50 MB.'); return }
    setBusy('upload'); setError(''); setUploadOpen(false)
    try {
      const result = await uploadPaper(file, userId)
      const paper: Paper = { paper_id: result.paper_id, filename: result.filename || file.name, status: 'ready', created_at: new Date().toISOString() }
      setPapers(previous => [paper, ...previous.filter(p => p.paper_id !== paper.paper_id)])
      attachPdf(paper.paper_id, file)
      setSelected(paper.paper_id); setPage(1); setView('Chat')
      setNotice('Your paper is ready to explore.')
    } catch (err) { setError((err as Error).message) } finally { setBusy(null) }
  }
  async function ask(value = question) {
    const text = value.trim()
    if (!text || !active || active.status !== 'ready' || busy) return
    const paperId = active.paper_id
    setMessages(previous => ({ ...previous, [paperId]: [...(previous[paperId] || []), { id: crypto.randomUUID(), role: 'user', text }] }))
    setQuestion(''); setBusy('answer'); setError(''); setView('Chat')
    try {
      const result = await askPaper(paperId, userId, text)
      setMessages(previous => ({ ...previous, [paperId]: [...(previous[paperId] || []), { id: crypto.randomUUID(), role: 'assistant', text: result.answer }] }))
    } catch (err) { setError((err as Error).message); setQuestion(text) } finally { setBusy(null) }
  }
  function saveNote(message: Message) {
    const next = [{ id: crypto.randomUUID(), paper: active ? title(active.filename) : 'Research note', text: message.text, date: new Date().toISOString() }, ...notes]
    if (!saveStorage(`paperpilot:notes:${userId}`, next)) { setError('Browser storage is full or unavailable. Your note could not be saved.'); return }
    setNotes(next); setNotice('Saved to your notes.')
  }
  function deleteNote(id: string) {
    const next = notes.filter(note => note.id !== id)
    if (!saveStorage(`paperpilot:notes:${userId}`, next)) { setError('Could not update browser storage.'); return }
    setNotes(next)
  }
  function exportNotes() {
    const text = notes.map(note => `## ${note.paper}\n\n${note.text}\n\nSaved ${new Date(note.date).toLocaleDateString()}\n`).join('\n---\n\n')
    const url = URL.createObjectURL(new Blob([`# PaperPilot research notes\n\n${text}`], { type: 'text/markdown' }))
    const link = document.createElement('a'); link.href = url; link.download = 'paperpilot-notes.md'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function copy(message: Message) {
    try { await navigator.clipboard.writeText(message.text); setCopied(message.id); setTimeout(() => setCopied(''), 2000) }
    catch { setError('Clipboard access is unavailable. You can select and copy the answer text.') }
  }
  function saveSettings(event: FormEvent) {
    event.preventDefault()
    const next = draftUserId.trim()
    if (!next || busy) return
    if (!saveStorage('paperpilot:user', next)) { setError('Could not save your workspace ID in this browser.'); return }
    if (next !== userId) {
      setPapers([]); setSelected(''); setMessages({}); setQuestion('')
      setNotes(readStorage(`paperpilot:notes:${next}`, [])); setUserId(next)
      setPdfs({}); pdfUrls.current.forEach(url => URL.revokeObjectURL(url)); pdfUrls.current = []
    }
    setNotice('Workspace settings saved.')
  }
  function newChat() {
    if (busy) return
    setMessages(previous => ({ ...previous, [selected]: [] })); setQuestion(''); navigate('Chat')
  }
  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask() }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to workspace</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`} aria-label="Main navigation">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('Chat') }}><Send size={31} strokeWidth={1.6} /><span>PaperPilot<span className="brand-dot">.</span></span></a>
      <button className="primary new-chat" onClick={newChat} disabled={!!busy}><Plus size={19} />New Chat<span className="shortcut">↗</span></button>
      <p className="nav-label">WORKSPACE</p>
      <nav>{navigation.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${view === label ? 'active' : ''}`} onClick={() => navigate(label)} aria-current={view === label ? 'page' : undefined}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{label === 'My Papers' && papers.length > 0 && <span className="nav-count">{papers.length}</span>}{label === 'Notes' && notes.length > 0 && <span className="nav-count">{notes.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><BookOpen size={20} /><strong>A little clarity goes a long way.</strong><p>Your papers. Your questions.<br />Every answer, grounded.</p></div><button className="profile" onClick={() => navigate('Settings')}><span className="avatar">{userId.charAt(0).toUpperCase()}</span><span><strong>{userId === 'default' ? 'My workspace' : userId}</strong><small>Personal research</small></span><ChevronDown size={15} /></button></div>
    </aside>

    <main id="main-content" className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={21} /></button><span>Workspace</span><span className="slash">/</span><strong>{view}</strong></div><div className="top-actions"><span className="private-label"><span className="status-dot" />Personal workspace</span><button className="secondary" disabled={!!busy} onClick={() => setUploadOpen(true)}><Upload size={16} /> <span>Upload paper</span></button></div></header>
      <div className="content">
        {error && <div role="alert" className="banner error"><Info size={18} /><span>{error}</span><button className="text-button" onClick={() => { setRetry(v => v + 1); setError('') }}>Retry connection</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        {busy === 'upload' && <div className="banner"><LoaderCircle className="spin" size={18} /><span>Reading your paper and preparing its evidence. This may take a few minutes…</span></div>}

        {view === 'Chat' && <>
          <div className="paper-bar"><div className="paper-file"><FileText size={23} /></div><div className="paper-title"><span className="eyebrow">ACTIVE PAPER</span><h1>{active ? title(active.filename) : 'Your next discovery starts here'}</h1><p>{active ? <><span className={`status-dot ${active.status === 'failed' ? 'failed' : active.status !== 'ready' ? 'pending' : ''}`} />{active.status === 'ready' ? 'Ready to explore' : active.status === 'failed' ? 'Processing failed' : 'Processing'}<span className="dot-separator">·</span>PDF document</> : 'A calmer space to make sense of your research.'}</p></div><div className="paper-controls">{papers.length > 0 && <select aria-label="Select active paper" disabled={!!busy} value={selected} onChange={event => { const paper = papers.find(p => p.paper_id === event.target.value); if (paper) choosePaper(paper) }}>{papers.map(p => <option key={p.paper_id} value={p.paper_id}>{title(p.filename)}</option>)}</select>}<button className="icon-button source-toggle" aria-label={showSource ? 'Hide source preview' : 'Show source preview'} onClick={() => setShowSource(v => !v)}>{showSource ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button></div></div>
          <div className={`research-grid ${showSource ? '' : 'without-source'}`}>
            <section className="chat-column" aria-label="Paper chat">
              <div className="chat-card"><div className="chat-heading"><div><h2>Explore your paper<span className="teal-dot">.</span></h2><p>Ask questions. Follow the evidence.</p></div><span className="outline-badge"><Sparkles size={12} /> Research assistant</span></div>
                <div className="conversation" aria-live="polite" aria-busy={busy === 'answer'}>
                  {currentMessages.length === 0 && <div className="chat-welcome"><div className="welcome-symbol"><Send size={29} strokeWidth={1.4} /></div><span className="eyebrow">LESS SEARCHING. MORE UNDERSTANDING.</span><h3>{active ? 'What would you like to discover?' : 'Big ideas begin with a paper.'}</h3><p>{active ? 'From the main idea to the finer details, explore answers drawn from your selected paper.' : 'Upload a research paper, ask what matters to you, and trace every answer back to its source.'}</p>{!active ? <button className="primary" disabled={!!busy} onClick={() => setUploadOpen(true)}><Plus size={17} />Add your first paper</button> : <div className="suggestions">{['What is this paper about?', 'Explain the main method', 'What are the key findings?'].map((prompt, i) => <button key={prompt} onClick={() => void ask(prompt)} disabled={!!busy || active.status !== 'ready'}>{i === 0 ? <BookOpen size={17} /> : i === 1 ? <Layers2 size={17} /> : <Sparkles size={17} />}<span>{prompt}</span><ArrowUp size={15} /></button>)}</div>}<div className="grounded-caption"><span className="status-dot" />Built around evidence, not guesswork</div></div>}
                  {currentMessages.map(message => {
                    if (message.role === 'user') return <div className="user-message" key={message.id}><div>{message.text}</div><span className="avatar small">{userId.charAt(0).toUpperCase()}</span></div>
                    const answer = parseAnswer(message.text)
                    return <article className="assistant-message" key={message.id}><div className="assistant-avatar"><Send size={19} /></div><div className="answer-content"><div className="answer-byline">PaperPilot<span>·</span><span>From your paper</span></div><p className="answer-text">{answer.text}</p>{answer.citations.length > 0 && <div className="sources"><h4>Sources <span>{answer.citations.length}</span></h4>{answer.citations.map((citation, index) => <button key={`${citation.section}-${index}`} className="source-card" onClick={() => { setPage(citation.page); setShowSource(true); if (!currentPdf) setNotice('Attach this paper’s PDF in the source panel to open its cited page.') }}><FileText size={20} /><div><strong><span>[{index + 1}]</span> {citation.section} <span className="source-page">· Page {citation.pages}</span></strong><small>{active ? title(active.filename) : 'Selected paper'}</small></div><ArrowRight size={16} /></button>)}</div>}<div className="answer-footer">{answer.confidence && <span><span className="status-dot" />Evidence confidence <strong>{answer.confidence}</strong><Info size={13} aria-label="Backend evidence support estimate" /></span>}<div><button className="icon-button" aria-label="Copy answer" title="Copy answer" onClick={() => void copy(message)}>{copied === message.id ? <Check size={16} /> : <Copy size={16} />}</button><button className="icon-button" aria-label="Save answer as note" title="Save to notes" onClick={() => saveNote(message)}><NotebookPen size={16} /></button></div></div></div></article>
                  })}
                  {busy === 'answer' && <div className="thinking"><div className="assistant-avatar"><Send size={19} /></div><LoaderCircle size={16} className="spin" /><span>Finding the evidence in your paper…</span></div>}<div ref={bottom} />
                </div>
              </div>
              <form className="composer" onSubmit={event => { event.preventDefault(); void ask() }}><div className="composer-input"><textarea aria-label="Question about your paper" placeholder={active ? 'Ask a question about this paper…' : 'Add a paper to start your conversation…'} rows={2} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={composerKey} disabled={!active || active.status !== 'ready' || !!busy} /><button className="primary send-button" type="submit" aria-label="Send question" disabled={!question.trim() || !active || active.status !== 'ready' || !!busy}>{busy === 'answer' ? <LoaderCircle className="spin" size={19} /> : <ArrowUp size={21} />}</button></div><div className="composer-caption"><span><span className="status-dot" />Answers grounded in your selected paper</span><span>↵ to send</span></div></form>
            </section>
            {showSource && <section className="source-panel" aria-label="PDF source preview"><div className="source-heading"><div><BookOpen size={17} /><h2>Source preview</h2></div><span className="outline-badge">PDF</span></div><div className="pdf-toolbar"><div><button className="icon-button" disabled={!currentPdf || page <= 1} aria-label="Previous page" onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={17} /></button><label className="page-control">Page<input aria-label="PDF page number" type="number" min={1} disabled={!currentPdf} value={page} onChange={event => setPage(Math.max(1, Number(event.target.value) || 1))} /></label><button className="icon-button" disabled={!currentPdf} aria-label="Next page" onClick={() => setPage(p => p + 1)}><ChevronRight size={17} /></button></div><button className="icon-button" disabled={!active} aria-label="Attach local PDF for preview" title="Attach local PDF for preview" onClick={() => localPdfInput.current?.click()}><FilePlus2 size={17} /></button></div><div className={`pdf-canvas ${currentPdf ? 'has-pdf' : ''}`}>{currentPdf ? <iframe key={`${currentPdf.url}-${page}`} src={`${currentPdf.url}#page=${page}`} title={`${currentPdf.name}, page ${page}`} /> : <div className="source-empty"><div className="paper-illustration" aria-hidden="true"><div className="illustration-heading" /><div /><div /><div /><div className="illustration-highlight" /><div /><div /><span><Search size={24} /></span></div><h3>Your evidence, in view.</h3><p>{active ? 'Attach the matching PDF to read alongside your conversation and jump to cited pages.' : 'When you upload a paper, it will appear here. Keep the original close while you explore.'}</p>{active && <button className="secondary" onClick={() => localPdfInput.current?.click()}><FilePlus2 size={16} />Attach PDF for preview</button>}<small><Info size={13} />Local previews stay in this browser session.</small></div>}</div><div className="source-panel-footer"><span className="status-dot" />{currentPdf ? 'Your original document' : 'A clear path from answer to source'}</div></section>}
          </div>
        </>}

        {view === 'My Papers' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">YOUR RESEARCH, TOGETHER</span><h1>My Papers<span className="teal-dot">.</span></h1><p>A home for the ideas you’re exploring.</p></div><button className="primary" disabled={!!busy} onClick={() => setUploadOpen(true)}><Plus size={17} />Add paper</button></div><div className="library-toolbar"><label className="search-box"><Search size={18} /><input placeholder="Search your papers…" aria-label="Search papers" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="secondary" onClick={() => setRetry(v => v + 1)} disabled={loading || !!busy}><RefreshCw size={15} className={loading ? 'spin' : ''} />Refresh</button></div>{loading ? <div className="empty-state"><LoaderCircle className="spin" /><p>Opening your library…</p></div> : papers.length === 0 ? <div className="empty-state"><FolderOpen size={36} strokeWidth={1.3} /><h2>Your library is a blank page.</h2><p>Add your first research paper and give your curiosity a place to land.</p><button className="primary" disabled={!!busy} onClick={() => setUploadOpen(true)}><Plus size={17} />Upload a PDF</button></div> : <div className="paper-list">{papers.filter(p => p.filename.toLowerCase().includes(search.toLowerCase())).map(paper => <button className="library-paper" key={paper.paper_id} disabled={!!busy} onClick={() => choosePaper(paper)}><div className="paper-file"><FileText size={23} /></div><div><h3>{title(paper.filename)}</h3><p>PDF document {paper.created_at && <>· Added {new Date(paper.created_at.includes('T') ? paper.created_at : paper.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}</>}</p></div><span className={`paper-status ${paper.status}`}><span className="status-dot" />{paper.status}</span><ArrowRight size={19} /></button>)}{papers.length > 0 && !papers.some(p => p.filename.toLowerCase().includes(search.toLowerCase())) && <div className="empty-state"><Search size={30} /><h2>No matching papers</h2><p>Try another title or clear your search.</p></div>}</div>}</section>}

        {view === 'Summaries' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">SEE THE BIG PICTURE</span><h1>A clearer overview<span className="teal-dot">.</span></h1><p>Start with the essentials, then go deeper.</p></div></div><div className="feature-card"><div className="feature-icon"><Layers2 size={28} /></div><h2>Understand the paper at a glance.</h2><p>Ask your research assistant for the problem, method, key findings, and limitations. The answer will appear in your chat with the evidence available in the paper.</p><label className="field-label">Choose a paper<select value={selected} disabled={!!busy || !papers.length} onChange={event => setSelected(event.target.value)}><option value="" disabled>Select from your library</option>{papers.map(p => <option key={p.paper_id} value={p.paper_id}>{title(p.filename)}</option>)}</select></label><button className="primary" disabled={!active || active.status !== 'ready' || !!busy} onClick={() => void ask('Summarize this paper: explain its problem, method, key results, limitations, and main takeaways. Use only evidence available in the paper and cite the relevant sections and pages.')}><Sparkles size={17} />Summarize in chat<ArrowRight size={16} /></button><small>Uses the existing question endpoint. Save useful answers to Notes.</small></div></section>}

        {view === 'Compare' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">CONNECT THE IDEAS</span><h1>A wider perspective<span className="teal-dot">.</span></h1><p>Different papers. A shared frame of reference.</p></div></div><div className="feature-card"><div className="feature-icon"><Scale size={29} /></div><span className="outline-badge">Planned feature</span><h2>Side-by-side research, coming next.</h2><p>Compare methods, datasets, findings, and limitations across papers. Your current API supports one paper per question; multi-paper comparison will be available when that capability is added.</p><div className="comparison-preview" aria-hidden="true"><div>Paper</div><div>Method</div><div>Results</div><div><span /></div><div><span /></div><div><span /></div><div><span /></div><div><span /></div><div><span /></div></div><button className="secondary" onClick={() => navigate('My Papers')}><FolderOpen size={17} />Explore your library<ArrowRight size={16} /></button></div></section>}

        {view === 'Notes' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">KEEP WHAT MATTERS</span><h1>Research notes<span className="teal-dot">.</span></h1><p>Your useful answers, saved for later in this browser.</p></div><button className="secondary" disabled={notes.length === 0} onClick={exportNotes}><ArrowDownToLine size={16} />Export Markdown</button></div>{notes.length === 0 ? <div className="empty-state"><NotebookPen size={36} strokeWidth={1.3} /><h2>Make room for your next insight.</h2><p>Save an answer using the note icon beneath it. Your notes and citations will stay together here.</p><button className="secondary" onClick={() => navigate('Chat')}><MessageCircle size={17} />Back to your research</button></div> : <div className="notes-grid">{notes.map(note => <article key={note.id} className="note-card"><div><span className="outline-badge"><FileText size={12} />Research note</span><button className="icon-button" aria-label={`Delete note from ${note.paper}`} onClick={() => deleteNote(note.id)}><Trash2 size={16} /></button></div><h2>{note.paper}</h2><p>{note.text}</p><small>{new Date(note.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small></article>)}</div>}</section>}

        {view === 'Settings' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">MAKE YOURSELF AT HOME</span><h1>Your workspace<span className="teal-dot">.</span></h1><p>A few details to keep your research in the right place.</p></div></div><form className="settings-card" onSubmit={saveSettings}><div className="settings-title"><Settings2 size={21} /><div><h2>Workspace preferences</h2><p>Connect to your existing paper library.</p></div></div><label className="field-label">Workspace user ID<input required maxLength={128} value={draftUserId} onChange={event => setDraftUserId(event.target.value)} disabled={!!busy} /><small>Use the same user_id you used when uploading papers through the API.</small></label><div className="info-box"><Info size={18} /><p>This ID selects your library; it is not a sign-in. Notes are saved locally in this browser. Chat history and attached PDF previews last for this session.</p></div><button className="primary" type="submit" disabled={!!busy || !draftUserId.trim()}><Check size={17} />Save preferences</button></form></section>}
        <footer className="workspace-footer"><span>PaperPilot</span><span>A little more clarity. A lot more possibility.</span><span>Made for curious minds<Send size={12} /></span></footer>
      </div>
    </main>

    <input ref={fileInput} className="sr-only" type="file" accept="application/pdf,.pdf" aria-label="Upload a research PDF" onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }} />
    <input ref={localPdfInput} className="sr-only" type="file" accept="application/pdf,.pdf" aria-label="Attach a local PDF for preview" onChange={event => { const file = event.target.files?.[0]; if (file && selected) { if (!/\.pdf$/i.test(file.name)) setError('Please choose a PDF file.'); else { attachPdf(selected, file); setPage(1); setNotice('Local PDF attached for this session.'); } } event.target.value = '' }} />
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    {uploadOpen && <div className="modal-backdrop" onClick={() => setUploadOpen(false)} onKeyDown={event => { if (event.key === 'Escape') setUploadOpen(false) }}><div className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Tab') { const targets = event.currentTarget.querySelectorAll<HTMLButtonElement>('button'); const first = targets[0]; const last = targets[targets.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } } }}><div className="modal-top"><span className="feature-icon"><Upload size={24} /></span><button ref={modalInput} className="icon-button" aria-label="Close upload dialog" onClick={() => setUploadOpen(false)}><X size={20} /></button></div><h2 id="upload-title">Bring your research in.</h2><p>A paper today. A new perspective tomorrow.</p><button className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files[0]) }} onClick={() => fileInput.current?.click()}><FilePlus2 size={33} strokeWidth={1.4} /><strong>Drop your PDF here</strong><span>or <b>browse files</b> to choose a paper</span><small>PDF documents · Up to 50 MB</small></button><div className="upload-note"><Info size={15} /><span>Choose a PDF with selectable text. Scanned images aren’t supported.</span></div><button className="text-button" onClick={() => setUploadOpen(false)}><ArrowLeft size={14} />Back to workspace</button></div></div>}
  </div>
}
