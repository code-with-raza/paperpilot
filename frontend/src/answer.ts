export interface Citation { section: string; page: number; pages: string }

// The existing API returns plain text with section/page lines and a confidence line.
// Keep the backend's wording and scores; never manufacture evidence metadata.
export function parseAnswer(answer: string) {
  const citations: Citation[] = []
  const body: string[] = []
  let confidence: string | undefined
  for (const line of answer.split('\n')) {
    const match = line.trim().match(/^Section:\s*(.+),\s*Pages?:\s*(\d+(?:-\d+)?)$/)
    if (match) {
      citations.push({ section: match[1], pages: match[2], page: Number(match[2].split('-')[0]) })
    } else if (line.startsWith('Evidence confidence:')) {
      confidence = line.replace('Evidence confidence:', '').trim()
    } else {
      body.push(line)
    }
  }
  return { text: body.join('\n').trim(), citations, confidence }
}
