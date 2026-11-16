import { ArrowRight, BookOpen, FileText, FlaskConical, Lightbulb, Link2, SearchCheck, Sparkles } from 'lucide-react'
import { parseMessageAnswer } from './answer'
import type { Citation } from './answer'
import type { ChatMessage } from './conversations'

const topics = [
  { title: 'Central idea', icon: Lightbulb, description: 'The research question and why it matters.', prompt: 'Explain the central research question, motivation, and main contribution of this paper. Cite the supporting sections and pages.' },
  { title: 'Methodology', icon: FlaskConical, description: 'How the research was carried out.', prompt: 'Explain this paper’s research methodology, datasets, experiments, and evaluation approach. Cite the supporting sections and pages.' },
  { title: 'Key findings', icon: SearchCheck, description: 'The results and evidence behind them.', prompt: 'What are the main findings of this paper? Include quantitative results only where provided and cite the supporting sections and pages.' },
  { title: 'Conclusions & limitations', icon: BookOpen, description: 'What we can conclude, and what remains open.', prompt: 'Explain this paper’s conclusions, limitations, and future research directions. Distinguish author claims from demonstrated results and cite sections and pages.' },
]

export function ResearchPanels({ tab, messages, paperTitle, ready, onAsk, onCitation }: {
  tab: 'takeaways' | 'references'
  messages: ChatMessage[]
  paperTitle: string
  ready: boolean
  onAsk: (prompt: string) => void
  onCitation: (citation: Citation) => void
}) {
  const citations = [...new Map(messages.filter(message => message.role === 'assistant').flatMap(message => parseMessageAnswer(message.content, message.sources).citations).map(citation => [`${citation.section}:${citation.pages}`, citation])).values()]
  return <section className="research-panel">
    <div className="panel-intro"><span className="panel-kicker">{tab === 'takeaways' ? 'UNDERSTAND THE RESEARCH' : 'FOLLOW THE EVIDENCE'}</span><h2>{tab === 'takeaways' ? 'The big picture. A little clearer.' : 'Every insight starts somewhere.'}</h2><p>{tab === 'takeaways' ? 'Explore the ideas, methods, and findings that matter. Each question opens an evidence-grounded answer in your chat.' : 'Revisit source passages cited in this conversation and check them against the original paper.'}</p></div>
    {tab === 'takeaways' ? <>
      <div className="takeaway-grid">{topics.map(({title,icon: Icon,description,prompt}, index) => <article className="takeaway-card" key={title}><div className="takeaway-top"><span><Icon size={22} /></span><small>0{index + 1}</small></div><h3>{title}</h3><p>{description}</p><button disabled={!ready} onClick={() => onAsk(prompt)}>Explore in chat <ArrowRight size={16} /></button></article>)}</div>
      <div className="takeaway-summary"><Sparkles size={22} /><div><h3>Start with a complete overview</h3><p>Ask for the essentials together, with citations you can follow.</p></div><button className="primary" disabled={!ready} onClick={() => onAsk('Summarize this paper using four headings: Central idea, Methodology, Key findings, and Conclusions and limitations. Use only evidence in the paper; cite the relevant sections and pages. State when evidence is unavailable.')} >Summarize in chat <ArrowRight size={16} /></button></div>
      {!ready && <p className="panel-caption">Select a paper that is ready for questions to explore its takeaways.</p>}
    </> : <>
      <div className="references-heading"><h3>Sources from this conversation <span>{citations.length}</span></h3><span>Section & page citations</span></div>
      {citations.length ? <div className="reference-list">{citations.map((citation,index) => <button key={`${citation.section}:${citation.pages}`} className="reference-item" onClick={() => onCitation(citation)}><span className="reference-number">{String(index+1).padStart(2,'0')}</span><span><strong>{citation.section}</strong><small>{paperTitle || 'Selected paper'}</small><span className="reference-page">{citation.page ? `Page ${citation.pages}` : 'Page not provided'}</span></span><ArrowRight size={18} /></button>)}</div> : <div className="references-empty"><Link2 size={30} /><h3>Build a trail of evidence</h3><p>Sources will appear here when your chat answers include citations. Ask a question to begin.</p><button className="secondary" disabled={!ready} onClick={() => onAsk('What is the main contribution of this paper? Cite the specific sections and pages that support your answer.')}><FileText size={16} />Ask with sources</button></div>}
      <p className="panel-caption">These are cited passages from your chat, not the paper’s full bibliography. No references are inferred or invented.</p>
    </>}
  </section>
}
