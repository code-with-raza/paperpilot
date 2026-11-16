export interface Citation {
  id?: number
  section: string
  page?: number
  pages: string
}

// The existing API returns plain text with section/page lines and a confidence line.
// Keep the backend's wording and scores; never manufacture evidence metadata.
export function parseAnswer(answer: string) {
  const citations: Citation[] = []
  const body: string[] = []
  let confidence: string | undefined
  let codeFence = ''
  for (const line of answer.split('\n')) {
    const fence = line.trim().match(/^(`{3,}|~{3,})/)
    if (fence) codeFence = codeFence ? '' : fence[1][0]
    if (codeFence || fence) {
      body.push(line)
      continue
    }
    const match = line
      .trim()
      .match(/^(?:\[(?:Source\s+)?(\d+)\]\s*)?Section:\s*(.+),\s*Pages?:\s*(.+)$/i)
    if (match) {
      const pageRange = match[3].trim().match(/^(\d+)(?:\s*[-–]\s*\d+)?$/)
      citations.push({
        id: match[1] ? Number(match[1]) : undefined,
        section: match[2],
        pages: match[3],
        page: pageRange && Number(pageRange[1]) > 0 ? Number(pageRange[1]) : undefined,
      })
    } else if (line.trim().startsWith('Evidence confidence:')) {
      confidence = line.replace('Evidence confidence:', '').trim()
    } else {
      body.push(line)
    }
  }
  const text = body.join('\n').trim()
  const prose = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, '')
  const sourceIds = [
    ...new Set([...prose.matchAll(/\[(?:Source\s+)?(\d+)\]/gi)].map((match) => Number(match[1]))),
  ].sort((a, b) => a - b)

  // The backend emits source metadata in ascending source-label order.
  // Map labels only when every entry can be matched unambiguously.
  if (sourceIds.length === citations.length) {
    citations.forEach((citation, index) => {
      citation.id ??= sourceIds[index]
    })
  }
  return { text, citations, confidence }
}

export function linkCitations(text: string, citations: Citation[]) {
  const knownIds = new Set(citations.map((citation) => citation.id))
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part.replace(/\[(?:Source\s+)?(\d+)\](?!\()/gi, (label, id: string) =>
        knownIds.has(Number(id)) ? `${label}(#source-${id})` : label,
      )
    })
    .join('')
}

// Conversation responses may include structured sources as well as the existing
// source lines in content. Prefer explicit backend metadata when supplied.
export function parseMessageAnswer(content: string, sources: Record<string, unknown>[] | null) {
  const answer = parseAnswer(content)
  if (!sources?.length) return answer
  const citations: Citation[] = sources.map((source) => {
    const section = source.section ?? source.section_name ?? source.title
    const start = source.page ?? source.page_start
    const end = source.page_end
    const pages =
      source.pages ??
      (start !== undefined ? `${start}${end !== undefined && end !== start ? `-${end}` : ''}` : '')
    const firstPage = String(pages).match(/^(\d+)/)
    const id = source.id ?? source.source_id
    return {
      id:
        typeof id === 'number'
          ? id
          : typeof id === 'string' && /^\d+$/.test(id)
            ? Number(id)
            : undefined,
      section: typeof section === 'string' ? section : 'Source',
      pages: String(pages),
      page: firstPage && Number(firstPage[1]) > 0 ? Number(firstPage[1]) : undefined,
    }
  })
  return { ...answer, citations }
}
