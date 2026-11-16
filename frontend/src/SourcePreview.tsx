import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Info,
  LoaderCircle,
  Search,
} from 'lucide-react'

interface Props {
  pdf?: { url: string; name: string }
  page: number
  loading: boolean
  warning: string
  hasPaper: boolean
  onPageChange: (page: number) => void
  onAttach: () => void
  onRetry: () => void
}

export function SourcePreview({
  pdf,
  page,
  loading,
  warning,
  hasPaper,
  onPageChange,
  onAttach,
  onRetry,
}: Props) {
  return (
    <section className="source-panel" aria-label="PDF source preview" aria-busy={loading}>
      <div className="source-heading">
        <div>
          <BookOpen size={17} />
          <h2>Source preview</h2>
        </div>
        <span className="outline-badge">PDF</span>
      </div>
      <div className="pdf-toolbar">
        <div>
          <button
            className="icon-button"
            disabled={!pdf || page <= 1}
            aria-label="Previous page"
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft size={17} />
          </button>
          <label className="page-control">
            Page
            <input
              aria-label="PDF page number"
              type="number"
              min={1}
              disabled={!pdf}
              value={page}
              onChange={(event) => onPageChange(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <button
            className="icon-button"
            disabled={!pdf}
            aria-label="Next page"
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <button
          className="icon-button"
          disabled={!hasPaper}
          aria-label="Attach local PDF for preview"
          title="Attach local PDF for preview"
          onClick={onAttach}
        >
          <FilePlus2 size={17} />
        </button>
      </div>
      {warning && (
        <div role="status" className="preview-warning">
          <Info size={15} />
          <span>{warning}</span>
          <button className="text-button" disabled={loading} onClick={onRetry}>
            Retry preview
          </button>
        </div>
      )}
      <div className={`pdf-canvas ${pdf ? 'has-pdf' : ''}`}>
        {pdf ? (
          <iframe
            key={`${pdf.url}-${page}`}
            src={`${pdf.url}#page=${page}`}
            title={`${pdf.name}, page ${page}`}
          />
        ) : loading ? (
          <div className="source-empty" role="status">
            <LoaderCircle className="spin" size={26} />
            <p>Loading your paper…</p>
          </div>
        ) : (
          <div className="source-empty">
            <div className="paper-illustration" aria-hidden="true">
              <div className="illustration-heading" />
              <div />
              <div />
              <div />
              <div className="illustration-highlight" />
              <div />
              <div />
              <span>
                <Search size={24} />
              </span>
            </div>
            <h3>Your evidence, in view.</h3>
            <p>
              {hasPaper
                ? 'The PDF could not be opened automatically. Check the message above, or attach the matching file to preview a local copy.'
                : 'When you upload a paper, it will appear here. Keep the original close while you explore.'}
            </p>
            {hasPaper && (
              <button className="secondary" onClick={onAttach}>
                <FilePlus2 size={16} />
                Attach PDF for preview
              </button>
            )}
            <small>
              <Info size={13} />
              Library PDFs open automatically from your server.
            </small>
          </div>
        )}
      </div>
      <div className="source-panel-footer">
        <span className="status-dot" />
        {pdf ? 'Your original document' : 'A clear path from answer to source'}
      </div>
    </section>
  )
}
