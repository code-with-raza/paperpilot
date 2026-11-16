import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const user = { id: 'user-a', email: 'reader@example.org', created_at: '2026-11-04 12:00:00' }
const paper = { paper_id: 'paper-1', filename: 'Attention_Is_All_You_Need.pdf', status: 'ready' }
const secondPaper = { ...paper, paper_id: 'paper-2', filename: 'Another_paper.pdf' }
const answer =
  'Each head uses a learned projection. [2]\n\nSection: Multi-Head Attention, Page: 4\n\nEvidence confidence: 92/100'
const makeConversation = (id: string, paperId = paper.paper_id, title = 'New chat') => ({
  id,
  user_id: user.id,
  title,
  paper_id: paperId,
  created_at: '2026-11-04 12:00:00',
  updated_at: '2026-11-04 12:00:00',
})
const makeMessage = (
  id: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
) => ({
  id,
  conversation_id: conversationId,
  role,
  content,
  sources: null as Record<string, unknown>[] | null,
  created_at: '2026-11-04 12:00:00',
})

// A valid, small PDF lets browser checks exercise the real PDF viewer as well.
function pdfFixture() {
  const stream = 'BT /F1 18 Tf 40 160 Td (PaperPilot test document) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

// Contract fixtures run only in tests. The application always uses real API requests.
async function backend(page: Page, signedIn = true) {
  const state = {
    user: signedIn ? (user as typeof user | null) : null,
    papers: [paper, secondPaper],
    conversations: [] as ReturnType<typeof makeConversation>[],
    messages: {} as Record<string, ReturnType<typeof makeMessage>[]>,
    creates: 0,
    sends: 0,
    retries: 0,
    retryStatus: 200,
    deletes: 0,
    loginStatus: 200,
    registerStatus: 201,
    importStatus: 'ready',
    sendStatus: 200,
    recoveryFails: false,
    listStatus: 200,
    requests: [] as string[],
  }
  await page.addInitScript(() => {
    const original = window.fetch
    ;(window as any).apiCalls = []
    window.fetch = (input, init) => {
      ;(window as any).apiCalls.push({ url: String(input), credentials: init?.credentials })
      return original(input, init)
    }
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api', '')
    const method = request.method()
    state.requests.push(`${method} ${path}`)
    expect(url.searchParams.has('user_id')).toBe(false)
    const body = request.headers()['content-type']?.includes('application/json')
      ? request.postDataJSON()
      : null
    if (body) expect(body).not.toHaveProperty('user_id')
    const respond = (json: unknown, status = 200) => route.fulfill({ status, json })
    if (path === '/auth/me')
      return state.user ? respond(state.user) : respond({ detail: 'Not authenticated.' }, 401)
    if (path === '/auth/logout') {
      state.user = null
      return respond({ message: 'Logged out successfully.' })
    }
    if (path === '/auth/login' || path === '/auth/register') {
      const status = path.endsWith('login') ? state.loginStatus : state.registerStatus
      expect(Object.keys(body).sort()).toEqual(['email', 'password'])
      if (status >= 400)
        return respond(
          {
            detail:
              status === 409
                ? 'An account with this email already exists.'
                : 'Invalid email or password.',
          },
          status,
        )
      state.user = user
      return route.fulfill({
        status,
        json: user,
        headers: {
          'set-cookie': 'paperpilot_access_token=test-cookie; HttpOnly; SameSite=Lax; Path=/',
        },
      })
    }
    if (!state.user) return respond({ detail: 'Not authenticated.' }, 401)
    if (path === '/papers/') return respond({ papers: state.papers })
    const retryMatch = path.match(/^\/papers\/([^/]+)\/retry$/)
    if (retryMatch && method === 'POST') {
      state.retries += 1
      expect(request.postData()).toBeNull()
      const retriedPaper = state.papers.find((item) => item.paper_id === retryMatch[1])
      if (!retriedPaper) return respond({ detail: 'Paper not found.' }, 404)
      if (state.retryStatus !== 200)
        return respond({ detail: 'Failed to retry paper processing.' }, state.retryStatus)
      state.papers = state.papers.map((item) =>
        item.paper_id === retriedPaper.paper_id ? { ...item, status: 'processing' } : item,
      )
      return respond({
        paper_id: retriedPaper.paper_id,
        status: 'processing',
        message: 'Paper processing has been queued again.',
      })
    }
    if (/^\/papers\/[^/]+\/pdf$/.test(path))
      return route.fulfill({
        contentType: 'application/pdf',
        body: pdfFixture(),
      })
    if (path === '/import-url/' || path === '/uploadfile/') {
      if (path === '/uploadfile/')
        expect(request.postDataBuffer()?.toString()).not.toContain('name="user_id"')
      const imported = {
        ...paper,
        paper_id: 'imported',
        filename: 'Imported_paper.pdf',
        status: state.importStatus,
      }
      state.papers.unshift(imported)
      return respond(imported)
    }
    if (path === '/conversations/' && method === 'GET')
      return state.listStatus === 200
        ? respond(state.conversations)
        : respond({ detail: 'Could not load conversations.' }, state.listStatus)
    if (path === '/conversations/' && method === 'POST') {
      expect(body).toEqual({ title: 'New chat', paper_id: expect.any(String) })
      state.creates += 1
      const conversation = {
        ...makeConversation(`chat-${state.creates}`, body.paper_id),
        user_id: state.user.id,
      }
      state.conversations.unshift(conversation)
      state.messages[conversation.id] = []
      return respond(conversation, 201)
    }
    const match = path.match(/^\/conversations\/([^/]+)(\/messages)?$/)
    if (match) {
      const id = match[1]
      const conversation = state.conversations.find(
        (item) => item.id === id && item.user_id === state.user?.id,
      )
      if (!conversation) return respond({ detail: 'Conversation not found.' }, 404)
      if (method === 'DELETE') {
        state.deletes += 1
        state.conversations = state.conversations.filter((item) => item.id !== id)
        delete state.messages[id]
        return respond({ message: 'Conversation deleted successfully.' })
      }
      if (match[2] && method === 'POST') {
        state.sends += 1
        expect(Object.keys(body)).toEqual(['question'])
        const question = makeMessage(`u-${state.sends}`, id, 'user', body.question)
        if (state.sendStatus === 500) {
          state.messages[id].push(question)
          return respond(
            {
              detail:
                'Failed to generate an answer. Your question has been saved; please try again.',
            },
            500,
          )
        }
        if (state.sendStatus !== 200)
          return respond(
            {
              detail:
                state.sendStatus === 400
                  ? 'This conversation is not linked to a paper.'
                  : 'Conversation not found.',
            },
            state.sendStatus,
          )
        const assistant = makeMessage(`a-${state.sends}`, id, 'assistant', answer)
        state.messages[id].push(question, assistant)
        state.conversations = [
          conversation,
          ...state.conversations.filter((item) => item.id !== id),
        ]
        return respond([question, assistant])
      }
      if (state.recoveryFails) return respond({ detail: 'Could not read saved messages.' }, 500)
      return respond({ ...conversation, messages: state.messages[id] || [] })
    }
    throw new Error(`Unexpected API request: ${method} ${path}`)
  })
  return state
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Question about your paper' })
async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}
async function signIn(page: Page) {
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('test-passphrase')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(composer(page)).toBeEnabled()
}

test('startup checks the session before loading private workspace data', async ({ page }) => {
  const state = await backend(page, false)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  expect(state.requests.every((request) => request.includes('/auth/me'))).toBe(true)
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

test('login validates fields, reveals passwords, handles rejection, and confirms the cookie', async ({
  page,
}) => {
  const state = await backend(page, false)
  state.loginStatus = 401
  await page.goto('/#/login')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByLabel('Email address')).toBeFocused()
  await expect(page.getByText('Enter your email address.')).toBeVisible()
  await page.getByLabel('Email address').fill('invalid')
  await page.getByLabel('Password', { exact: true }).fill('test-passphrase')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByText('Enter a valid email address.')).toBeVisible()
  await page.getByLabel('Email address').fill(user.email)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid email or password.')
  state.loginStatus = 200
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(composer(page)).toBeEnabled()
  await expect(page.locator('.profile')).toContainText(user.email)
  expect(
    (await page.context().cookies()).find((cookie) => cookie.name === 'paperpilot_access_token')
      ?.httpOnly,
  ).toBe(true)
  const calls = await page.evaluate(() => (window as any).apiCalls)
  expect(calls.every((call: any) => call.credentials === 'include')).toBe(true)
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))
  expect(storage).not.toContain('test-passphrase')
  expect(storage).not.toContain('test-cookie')
})

test('registration checks password requirements and duplicate accounts before opening the workspace', async ({
  page,
}) => {
  const state = await backend(page, false)
  state.registerStatus = 409
  await page.goto('/#/register')
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('short')
  await page.getByLabel('Confirm password', { exact: true }).fill('different')
  await page.getByRole('button', { name: 'Register', exact: true }).click()
  await expect(page.getByText('Use between 8 and 128 characters for your password.')).toBeVisible()
  await expect(page.getByText('Your passwords do not match.')).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill('test-passphrase')
  await page.getByLabel('Confirm password', { exact: true }).fill('test-passphrase')
  await page.getByRole('button', { name: 'Register', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('already exists')
  state.registerStatus = 201
  await page.getByRole('button', { name: 'Register', exact: true }).click()
  await expect(composer(page)).toBeEnabled()
  await expect(page.locator('.library-paper')).toHaveCount(0) // Library stays in its existing view.
  expect(state.requests).toContain('GET /conversations/')
  expect(state.requests).toContain('GET /papers/')
})

test('a successful login response alone does not bypass cookie verification', async ({ page }) => {
  await backend(page, false)
  await page.route('**/api/auth/login', (route) => route.fulfill({ json: user }))
  await page.goto('/#/login')
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('test-passphrase')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('session cookie')
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

test('session check network failures have a retry action', async ({ page }) => {
  await backend(page)
  let fails = true
  await page.route('**/api/auth/me', (route) =>
    fails ? route.abort() : route.fulfill({ json: user }),
  )
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Could not connect')
  fails = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(composer(page)).toBeEnabled()
})

test('sidebar preserves server ordering and restores older messages, paper, citations, and confidence', async ({
  page,
}) => {
  const state = await backend(page)
  state.conversations = [
    makeConversation('latest', paper.paper_id, 'Latest chat'),
    makeConversation('older', secondPaper.paper_id, 'Earlier research'),
  ]
  state.messages.older = [
    makeMessage('old-u', 'older', 'user', 'What was the result?'),
    makeMessage('old-a', 'older', 'assistant', answer),
  ]
  await page.goto('/')
  await expect(page.locator('.history-select')).toHaveText(['Latest chat', 'Earlier research'])
  await page.getByRole('button', { name: 'Earlier research', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Another paper', exact: true })).toBeVisible()
  await expect(page.locator('.user-message')).toHaveText('What was the result?R')
  await expect(page.locator('.answer-text')).toContainText('Each head uses a learned projection.')
  await expect(page.locator('.answer-footer')).toContainText('92/100')
  await expect(page.locator('.history-select[aria-current=true]')).toHaveText('Earlier research')
  await page.locator('.source-card').click()
  await expect(page.locator('iframe')).toHaveAttribute('title', 'Another_paper.pdf, page 4')
  await page.reload()
  await expect(composer(page)).toBeEnabled()
  await expect(page.locator('.answer-text')).toHaveCount(0)
  await page.getByRole('button', { name: 'Earlier research', exact: true }).click()
  await expect(page.locator('.answer-text')).toContainText('Each head uses a learned projection.')
  await expect(page.getByRole('heading', { name: 'Another paper', exact: true })).toBeVisible()
})

test('new chat is a local draft and does not create empty server conversations', async ({ page }) => {
  const state = await backend(page)
  state.papers = []
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await page.getByRole('button', { name: 'New Chat', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(state.creates).toBe(0)
  state.papers = [paper]
  await page.reload()
  await expect(composer(page)).toBeEnabled()
  await page.getByRole('button', { name: 'New Chat', exact: true }).click()
  await page.getByRole('button', { name: 'New Chat', exact: true }).click()
  await expect(page.locator('.history-select')).toHaveCount(0)
  expect(state.creates).toBe(0)
})

test('messages use saved conversation endpoints once and keep the selected conversation', async ({
  page,
}) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page, 'Explain attention')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  await expect(page.locator('.user-message')).toHaveCount(1)
  await expect(page.locator('.history-select[aria-current=true]')).toHaveCount(1)
  await send(page, 'Explain the next step')
  await expect(page.locator('.assistant-message')).toHaveCount(2)
  await expect(page.locator('.user-message')).toHaveCount(2)
  expect(state.creates).toBe(1)
  expect(state.sends).toBe(2)
  expect(state.requests.some((request) => request.endsWith('/ask'))).toBe(false)
  await page.screenshot({ path: '../tmp/auth-history-desktop.png', fullPage: true })
  await page.reload()
  await expect(page.locator('.assistant-message')).toHaveCount(2)
})

test('a failed generation reloads the persisted question without appending duplicates', async ({
  page,
}) => {
  const state = await backend(page)
  state.sendStatus = 500
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page, 'Explain the result')
  await expect(page.getByRole('alert')).toContainText('Your question has been saved')
  await expect(page.locator('.user-message')).toHaveCount(1)
  await expect(page.locator('.assistant-message')).toHaveCount(0)
  expect(state.requests).toContain('GET /conversations/chat-1')
  state.sendStatus = 200
  await send(page, 'Try explaining the saved question')
  await expect(page.locator('.user-message')).toHaveCount(2)
  await expect(page.locator('.assistant-message')).toHaveCount(1)
})

test('failed history recovery blocks another send until messages can be reloaded', async ({
  page,
}) => {
  const state = await backend(page)
  state.sendStatus = 500
  state.recoveryFails = true
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page, 'Saved question')
  await expect(page.getByRole('button', { name: 'Reload conversation', exact: true })).toBeVisible()
  await expect(composer(page)).toBeEnabled()
  await send(page, 'Do not duplicate this question')
  await expect(page.locator('.banner.error')).toContainText('Reload saved messages')
  expect(state.sends).toBe(1)
  state.recoveryFails = false
  await page.getByRole('button', { name: 'Reload conversation', exact: true }).click()
  await expect(page.locator('.user-message')).toHaveCount(1)
  await expect(composer(page)).toBeEnabled()
})

for (const status of [400, 404]) {
  test(`message HTTP ${status} errors remain visible and do not fabricate answers`, async ({
    page,
  }) => {
    const state = await backend(page)
    state.sendStatus = status
    await page.goto('/')
    await expect(composer(page)).toBeEnabled()
    await send(page, 'Explain the result')
    await expect(page.getByRole('alert')).toContainText(
      status === 400 ? 'not linked to a paper' : 'Conversation not found',
    )
    await expect(page.locator('.assistant-message')).toHaveCount(0)
    await expect(composer(page)).toHaveValue('Explain the result')
  })
}

test('delete requires confirmation and clears only the deleted chat', async ({ page }) => {
  const state = await backend(page)
  state.conversations = [makeConversation('one', paper.paper_id, 'Research notes')]
  state.messages.one = [makeMessage('one-u', 'one', 'user', 'Existing question')]
  await page.goto('/')
  await page.getByRole('button', { name: 'Research notes', exact: true }).click()
  await expect(page.locator('.user-message')).toHaveCount(1)
  const cancelDialog = page.waitForEvent('dialog').then((dialog) => dialog.dismiss())
  await Promise.all([
    cancelDialog,
    page.getByRole('button', { name: 'Delete conversation Research notes' }).click(),
  ])
  expect(state.deletes).toBe(0)
  const confirmDialog = page.waitForEvent('dialog').then((dialog) => dialog.accept())
  await Promise.all([
    confirmDialog,
    page.getByRole('button', { name: 'Delete conversation Research notes' }).click(),
  ])
  await expect(page.locator('.history-select')).toHaveCount(0)
  await expect(page.locator('.user-message')).toHaveCount(0)
  await expect(page.locator('iframe')).toBeVisible()
  expect(state.deletes).toBe(1)
})

test('logout clears private state and a second account gets only its own history', async ({
  page,
}) => {
  const state = await backend(page)
  state.conversations = [makeConversation('private-a', paper.paper_id, 'Account A private chat')]
  state.messages['private-a'] = [
    makeMessage('private-message', 'private-a', 'user', 'Account A private question'),
  ]
  await page.goto('/')
  await page.getByRole('button', { name: 'Account A private chat', exact: true }).click()
  await expect(page.locator('.user-message')).toContainText('Account A private question')
  await page.getByRole('button', { name: 'Log out of PaperPilot' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveCount(0)
  state.conversations = [
    { ...makeConversation('private-b', paper.paper_id, 'Account B chat'), user_id: 'user-b' },
  ]
  state.messages = { 'private-b': [] }
  await page.route('**/api/auth/login', async (route) => {
    state.user = { ...user, id: 'user-b', email: 'another@example.org' }
    await route.fulfill({ json: state.user })
  })
  await signIn(page)
  await expect(page.locator('.history-select')).toHaveText(['Account B chat'])
  await expect(page.getByText('Account A private question')).toHaveCount(0)
  await expect(page.locator('.profile')).toContainText('another@example.org')
})

test('session expiry returns to login and removes visible account data', async ({ page }) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await expect(page.locator('iframe')).toBeVisible()
  state.user = null
  await send(page, 'Explain the result')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByText('Your session has expired. Please sign in again.')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

for (const url of [
  'https://arxiv.org/abs/1706.03762',
  'https://arxiv.org/pdf/1706.03762.pdf',
  'https://example.org/paper.pdf?download=1',
]) {
  test(`imports ${url} and opens its PDF without a frontend user ID`, async ({ page }) => {
    const state = await backend(page)
    state.papers = []
    await page.goto('/')
    await expect(composer(page)).toBeEnabled()
    await send(page, url)
    await expect(page.getByRole('heading', { name: 'Imported paper', exact: true })).toBeVisible()
    await expect(page.locator('iframe')).toHaveAttribute('title', 'Imported_paper.pdf, page 1')
    expect(state.creates).toBe(0)
    await send(page, 'Explain this paper')
    await expect(page.locator('.assistant-message')).toHaveCount(1)
    expect(state.conversations[0].paper_id).toBe('imported')
  })
}

test('upload, gallery, preview reopening, and citation navigation remain available', async ({
  page,
}) => {
  await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await page.getByLabel('Upload a research PDF', { exact: true }).setInputFiles({
    name: 'Local.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFixture(),
  })
  await expect(page.getByRole('heading', { name: 'Imported paper', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Hide source preview' }).click()
  await page.getByRole('button', { name: /^My Papers/ }).click()
  await page.locator('.library-paper').filter({ hasText: 'Attention Is All You Need' }).click()
  await expect(page.locator('iframe')).toHaveAttribute(
    'title',
    'Attention_Is_All_You_Need.pdf, page 1',
  )
  await send(page, 'Explain attention')
  await expect(page.getByRole('button', { name: 'Copy answer', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save answer as note' })).toHaveCount(0)
})

test('structured sources, confidence, and safe Markdown survive loading saved history', async ({
  page,
}) => {
  const state = await backend(page)
  state.conversations = [makeConversation('structured', paper.paper_id, 'Evidence')]
  const message = makeMessage(
    'structured-a',
    'structured',
    'assistant',
    '**A result** [3]\n\n<script>window.bad=true</script>\n\n![tracker](https://example.org/tracker.png)\n\nEvidence confidence: 87/100',
  )
  message.sources = [{ id: 3, section_name: 'Results', page_start: 2, page_end: 3 }]
  state.messages.structured = [message]
  await page.goto('/')
  await page.getByRole('button', { name: 'Evidence', exact: true }).click()
  await expect(page.locator('.answer-text strong')).toHaveText('A result')
  await expect(page.locator('.answer-text img, .answer-text script')).toHaveCount(0)
  await expect(page.locator('.source-card')).toContainText('Results')
  await expect(page.locator('.answer-footer')).toContainText('87/100')
  await page.getByRole('button', { name: '[3]', exact: true }).click()
  await expect(page.locator('iframe')).toHaveAttribute(
    'title',
    'Attention_Is_All_You_Need.pdf, page 2',
  )
})

test('duplicate submissions are locked while waiting for saved messages', async ({ page }) => {
  const state = await backend(page)
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/conversations/*/messages', async (route) => {
    await ready
    await route.fallback()
  })
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page, 'One question')
  await expect(composer(page)).toBeDisabled()
  await page.locator('form.composer').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  release()
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  expect(state.sends).toBe(1)
  expect(state.creates).toBe(1)
})

test('changing the active paper starts a separate conversation', async ({ page }) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page, 'Question for first paper')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  await page.getByLabel('Select active paper').selectOption('paper-2')
  await expect(page.locator('.assistant-message')).toHaveCount(0)
  await send(page, 'Question for second paper')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  expect(state.conversations.map((item) => item.paper_id)).toEqual(['paper-2', 'paper-1'])
})

test('mobile login, registration, saved sidebar, and PDF layout stay within the viewport', async ({
  page,
}) => {
  const state = await backend(page, false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/register')
  await expect(page.getByRole('heading', { name: 'Create your account.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('link', { name: 'Log in', exact: true }).click()
  state.conversations = [makeConversation('mobile', paper.paper_id, 'Mobile research')]
  await signIn(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.screenshot({ path: '../tmp/auth-history-sidebar-mobile.png' })
  await page.getByRole('button', { name: 'Mobile research', exact: true }).click()
  await expect(composer(page)).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: '../tmp/auth-history-mobile.png', fullPage: true })
})

test('foreign conversation records and a legacy local user ID cannot select another account', async ({
  page,
}) => {
  const state = await backend(page)
  state.conversations = [
    makeConversation('owned', paper.paper_id, 'My research'),
    { ...makeConversation('foreign', paper.paper_id, 'Foreign research'), user_id: 'other-user' },
  ]
  await page.addInitScript(() =>
    localStorage.setItem('paperpilot:user', JSON.stringify('other-user')),
  )
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await expect(page.locator('.history-select')).toHaveText(['My research'])
  await expect(page.locator('.profile')).toContainText(user.email)
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0)
  await expect(page.getByText('Workspace user ID', { exact: true })).toHaveCount(0)
})

test('a failed sidebar load can be retried without leaving a stale error', async ({ page }) => {
  const state = await backend(page)
  state.listStatus = 500
  state.conversations = [makeConversation('retry-chat', paper.paper_id, 'Recovered research')]
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Could not load conversations.')
  state.listStatus = 200
  await page.getByRole('button', { name: 'Reload chats', exact: true }).click()
  await expect(page.locator('.history-select')).toHaveText(['Recovered research'])
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('pending email verification shows the complete confirmation without signing in', async ({
  page,
}) => {
  const state = await backend(page, false)
  await page.route('**/api/auth/register', (route) =>
    route.fulfill({
      status: 403,
      json: { detail: 'Please verify your email before logging in.' },
    }),
  )
  await page.goto('/#/register')
  await expect(page.getByRole('heading', { name: 'Create your account.' })).toBeVisible()
  const sessionChecks = state.requests.filter((request) => request === 'GET /auth/me').length
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('test-passphrase')
  await page.getByLabel('Confirm password').fill('test-passphrase')
  await page.getByRole('button', { name: 'Register', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your email.' })).toBeFocused()
  await expect(page.getByRole('status')).toHaveText(
    "Your account has been created successfully! Please check your email inbox (or Gmail) for the verification link. If you don't see it, check your Spam or Junk folder. Verify your email before logging in.",
  )
  await expect(page.locator('.app-shell')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Register', exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(state.requests.filter((request) => request === 'GET /auth/me')).toHaveLength(sessionChecks)
  expect(
    state.requests.some(
      (request) => request.includes('/papers/') || request.includes('/conversations/'),
    ),
  ).toBe(false)
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    'test-passphrase',
  )
  await page.screenshot({ path: '../tmp/registration-verification-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: '../tmp/registration-verification-mobile.png', fullPage: true })
  await page.getByRole('link', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await signIn(page)
})

test('an unrelated registration 403 remains an error rather than account confirmation', async ({
  page,
}) => {
  await backend(page, false)
  await page.route('**/api/auth/register', (route) =>
    route.fulfill({ status: 403, json: { detail: 'Registration is unavailable.' } }),
  )
  await page.goto('/#/register')
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('test-passphrase')
  await page.getByLabel('Confirm password').fill('test-passphrase')
  await page.getByRole('button', { name: 'Register', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Registration is unavailable.')
  await expect(page.getByRole('heading', { name: 'Check your email.' })).toHaveCount(0)
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

test('Shift+Enter adds a newline and Send submits ordinary text through the conversation API', async ({
  page,
}) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await composer(page).fill('First line')
  await composer(page).press('Shift+Enter')
  await composer(page).pressSequentially('Second line')
  await expect(composer(page)).toHaveValue('First line\nSecond line')
  expect(state.creates).toBe(0)
  expect(state.sends).toBe(0)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  expect(state.messages['chat-1'][0].content).toBe('First line\nSecond line')
  expect(state.requests.some((request) => request.endsWith('/ask'))).toBe(false)
})

test('composition Enter and repeated keydown do not prematurely submit a question', async ({
  page,
}) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await composer(page).fill('Question being composed')
  await composer(page).dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
  })
  await composer(page).dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    repeat: true,
    bubbles: true,
  })
  expect(state.creates).toBe(0)
  expect(state.sends).toBe(0)
  await composer(page).press('Enter')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  expect(state.sends).toBe(1)
})

test('URL import shows loading, preserves failed input, supports Send retry, and tracks background processing', async ({
  page,
}) => {
  const state = await backend(page)
  state.papers = []
  state.importStatus = 'processing'
  const input = 'https://example.org/paper.pdf?download=1&utm_source=test'
  let attempts = 0
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/import-url/', async (route) => {
    attempts += 1
    expect(route.request().postDataJSON()).toEqual({ pdf_url: input })
    if (attempts === 1) {
      await pending
      return route.fulfill({
        status: 502,
        json: { detail: 'Could not download the PDF from the provided URL.' },
      })
    }
    return route.fallback()
  })
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  const libraryReads = state.requests.filter((request) => request === 'GET /papers/').length
  await send(page, input)
  await expect(page.getByRole('status')).toContainText('Importing your paper from its URL')
  await expect(composer(page)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
  await page.locator('form.composer').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  expect(attempts).toBe(1)
  release()
  await expect(page.locator('.banner.error')).toContainText('Could not download the PDF')
  await expect(composer(page)).toHaveValue(input)
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('heading', { name: 'Imported paper', exact: true })).toBeVisible()
  await expect(page.locator('.paper-bar')).toContainText('Processing')
  await expect(page.locator('iframe')).toHaveAttribute('title', 'Imported_paper.pdf, page 1')
  await expect
    .poll(() => state.requests.filter((request) => request === 'GET /papers/').length)
    .toBeGreaterThan(libraryReads)
  await send(page, 'Is the paper ready?')
  await expect(page.locator('.banner.error')).toContainText('not ready for questions')
  expect(state.sends).toBe(0)
  state.papers = state.papers.map((item) => ({ ...item, status: 'ready' }))
  await expect(page.locator('.paper-bar')).toContainText('Ready to explore', { timeout: 12000 })
  await send(page, 'Explain this paper')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  expect(attempts).toBe(2)
})

test('a PDF URL can be imported while the previous conversation needs recovery', async ({
  page,
}) => {
  const state = await backend(page)
  state.sendStatus = 500
  state.recoveryFails = true
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page, 'Saved question')
  await expect(page.getByRole('button', { name: 'Reload conversation', exact: true })).toBeVisible()
  await expect(composer(page)).toBeEnabled()
  await send(page, 'https://arxiv.org/pdf/1706.03762v2.pdf')
  await expect(page.getByRole('heading', { name: 'Imported paper', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload conversation', exact: true })).toHaveCount(
    0,
  )
  expect(state.requests).toContain('POST /import-url/')
  expect(state.sends).toBe(1)
})

test('questions containing a URL remain questions rather than imports', async ({ page }) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page, 'Does this paper discuss https://example.org/another.pdf?')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  expect(state.requests).not.toContain('POST /import-url/')
})

test('failed-paper retry uses the actual ID once, shows loading, and follows existing status polling', async ({
  page,
}) => {
  const state = await backend(page)
  state.papers = [paper, { ...secondPaper, status: 'failed' }]
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let attempts = 0
  await page.route('**/api/papers/paper-2/retry', async (route) => {
    attempts += 1
    await waiting
    await route.fallback()
  })
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await page.getByRole('button', { name: /^My Papers/ }).click()
  await expect(page.getByRole('button', { name: 'Retry Processing', exact: true })).toHaveCount(1)
  const failedRow = page.locator('.library-paper-row').filter({ hasText: 'Another paper' })
  await expect(failedRow).toContainText('Processing failed')
  await expect(failedRow.locator('.library-paper')).toHaveAttribute('aria-pressed', 'false')
  await failedRow.getByRole('button', { name: 'Retry Processing', exact: true }).click()
  const retryButton = failedRow.getByRole('button', { name: 'Retrying...', exact: true })
  await expect(retryButton).toBeDisabled()
  await expect(retryButton).toHaveAttribute('aria-busy', 'true')
  await retryButton.evaluate((button) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  expect(attempts).toBe(1)
  release()
  await expect(failedRow.locator('.paper-status')).toHaveText('Processing')
  await expect(failedRow.locator('.paper-retry')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'My Papers.', exact: true })).toBeVisible()
  await expect(page.locator('.library-paper')).toHaveCount(2)
  await expect(
    page.locator('.library-paper').filter({ hasText: 'Attention Is All You Need' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(state.retries).toBe(1)
  expect(state.creates).toBe(0)
  expect(state.requests).toContain('POST /papers/paper-2/retry')
  expect(state.requests).not.toContain('POST /uploadfile/')
  expect(state.requests).not.toContain('POST /import-url/')
  const retryCalls = await page.evaluate(() =>
    (window as any).apiCalls.filter((call: any) => call.url.endsWith('/papers/paper-2/retry')),
  )
  expect(retryCalls).toEqual([{ url: '/api/papers/paper-2/retry', credentials: 'include' }])
  state.papers = state.papers.map((item) => ({ ...item, status: 'ready' }))
  await expect(failedRow.locator('.paper-status')).toHaveText('Ready to explore', {
    timeout: 12000,
  })
})

for (const status of [400, 500]) {
  test(`failed retry HTTP ${status} keeps the action available for another attempt`, async ({
    page,
  }) => {
    const state = await backend(page)
    state.papers = [{ ...paper, status: 'failed' }, secondPaper]
    state.retryStatus = status
    await page.goto('/')
    await expect(composer(page)).toBeEnabled()
    await page.getByRole('button', { name: /^My Papers/ }).click()
    await page.getByRole('button', { name: 'Retry Processing', exact: true }).click()
    await expect(page.locator('.banner.error')).toContainText('Failed to retry paper processing.')
    await expect(page.getByRole('button', { name: 'Retry Processing', exact: true })).toBeEnabled()
    await expect(page.locator('.paper-status.failed')).toHaveCount(1)
    state.retryStatus = 200
    await page.getByRole('button', { name: 'Retry Processing', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry Processing', exact: true })).toHaveCount(0)
    await expect(page.locator('.paper-status.processing')).toHaveCount(1)
    expect(state.retries).toBe(2)
    await expect(page.locator('.library-paper')).toHaveCount(2)
  })
}

test('failed-paper retry layout fits mobile and keeps opening the PDF as a separate action', async ({
  page,
}) => {
  const state = await backend(page)
  state.papers = [{ ...paper, status: 'failed' }, secondPaper]
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: /^My Papers/ }).click()
  await expect(page.getByRole('button', { name: 'Retry Processing', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: '../tmp/paper-retry-mobile.png', fullPage: true })
  await page.locator('.library-paper').filter({ hasText: 'Attention Is All You Need' }).click()
  await expect(page.locator('iframe')).toHaveAttribute(
    'title',
    'Attention_Is_All_You_Need.pdf, page 1',
  )
  expect(state.retries).toBe(0)
})

test('research tools preserve real chat, show cited passages, and open Paper View in a new tab', async ({ page }) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  const paperView = page.getByRole('link', { name: 'Paper View', exact: true })
  await expect(paperView).toHaveAttribute('target', '_blank')
  await expect(paperView).toHaveAttribute('href', /^blob:/)
  await expect(page.getByRole('link', { name: 'Download paper', exact: true })).toHaveAttribute('download', paper.filename)
  await page.getByRole('button', { name: 'References', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Build a trail of evidence' })).toBeVisible()
  await page.getByRole('button', { name: 'Key Takeaways', exact: true }).click()
  await expect(page.locator('.takeaway-card')).toHaveCount(4)
  expect(state.sends).toBe(0)
  await page.locator('.takeaway-card').first().getByRole('button', { name: 'Explore in chat' }).click()
  await expect(page.locator('.answer-text')).toContainText('Each head uses a learned projection.')
  expect(state.sends).toBe(1)
  await page.getByRole('button', { name: 'References', exact: true }).click()
  await expect(page.locator('.reference-item')).not.toHaveCount(0)
  await page.locator('.reference-item').first().click()
  await expect(page.getByRole('button', { name: 'Chat with Paper' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('iframe')).toHaveAttribute('src', /#page=4$/)
  await page.getByRole('button', { name: 'Hide source preview' }).click()
  await page.screenshot({ path: 'test-results/research-workspace-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Key Takeaways', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The big picture. A little clearer.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/research-workspace-mobile.png', fullPage: true })
})

test('sidebar URL import uses the existing endpoint and paper library search works', async ({ page }) => {
  const state = await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await page.getByRole('textbox', { name: 'Search workspace papers' }).fill('Another')
  await expect(page.locator('.library-paper')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Search workspace papers' }).fill('')
  await page.getByRole('button', { name: 'Import arXiv URL', exact: true }).click()
  await page.getByLabel('Paper URL', { exact: true }).fill('https://arxiv.org/abs/2401.12345')
  await page.getByRole('button', { name: 'Import paper', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Imported paper', exact: true })).toBeVisible()
  expect(state.requests).toContain('POST /import-url/')
})

test('reference layout collections organize papers locally and persist across reloads', async ({ page }) => {
  await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('.paper-rail')).toHaveCount(0)
  await page.getByRole('button', { name: 'Create collection', exact: true }).click()
  await page.getByRole('textbox', { name: 'Collection name' }).fill('Thesis Reading')
  await page.getByRole('button', { name: 'Save collection', exact: true }).click()
  await page.locator('.paper-menu summary').click()
  const collectionSelect = page.getByRole('combobox', { name: 'Add paper to collection' })
  await collectionSelect.selectOption({ label: 'Add to Thesis Reading' })
  await page.locator('.paper-menu summary').click()
  await page.locator('.collection-item').filter({ hasText: 'Thesis Reading' }).click()
  await expect(page.locator('.library-paper')).toHaveCount(1)
  await expect(page.locator('.library-paper')).toContainText('Attention Is All You Need')
  await page.reload()
  await expect(page.locator('.collection-item').filter({ hasText: 'Thesis Reading' })).toContainText('1')
  await send(page, 'Explain attention')
  await expect(page.locator('.sources')).toBeVisible()
  await page.screenshot({ path: 'test-results/reference-layout-desktop.png', fullPage: true })
})

test('chat-first sidebar starts a fresh draft and keeps previous chats available', async ({ page }) => {
  const state = await backend(page)
  state.conversations = [makeConversation('previous', paper.paper_id, 'Previous research')]
  state.messages.previous = [makeMessage('previous-question','previous','user','My earlier research question'),makeMessage('previous-answer','previous','assistant',answer)]
  await page.addInitScript(() => localStorage.setItem('paperpilot:conversation:user-a','previous'))
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Previous research', exact: true })).toBeVisible()
  await expect(page.locator('.user-message')).toHaveCount(0)
  for (const label of ['Compare','Summaries','Notes','Settings','Account settings']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
  }
  expect(state.creates).toBe(0)
  await page.getByRole('button', { name: 'Previous research', exact: true }).click()
  await expect(page.locator('.user-message')).toContainText('My earlier research question')
  await page.getByRole('button', { name: 'New Chat', exact: true }).click()
  await expect(page.locator('.user-message')).toHaveCount(0)
  await expect(composer(page)).toHaveValue('')
  expect(state.creates).toBe(0)
  await send(page,'A fresh research question')
  await expect(page.locator('.answer-text')).toContainText('Each head uses a learned projection.')
  expect(state.creates).toBe(1)
  await expect(page.getByRole('button', { name: 'Previous research', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/chat-first-sidebar.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('button', { name: 'Previous research', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('submitted question appears before chat creation and generation finish without duplicating saved messages', async ({ page }) => {
  await backend(page)
  let releaseCreate!: () => void
  let releaseAnswer!: () => void
  const creationGate = new Promise<void>(resolve => { releaseCreate = resolve })
  const answerGate = new Promise<void>(resolve => { releaseAnswer = resolve })
  let answerRequested = false
  await page.route('**/api/conversations/', async route => {
    if (route.request().method() === 'POST') await creationGate
    await route.fallback()
  })
  await page.route('**/api/conversations/*/messages', async route => {
    if (route.request().method() === 'POST') { answerRequested = true; await answerGate }
    await route.fallback()
  })
  try {
    await page.goto('/')
    await expect(composer(page)).toBeEnabled()
    await send(page,'Show my question immediately')
    await expect(page.locator('.user-message')).toHaveCount(1)
    await expect(page.locator('.user-message')).toContainText('Show my question immediately')
    expect(answerRequested).toBe(false)
    await expect(page.locator('.assistant-message')).toHaveCount(0)
    releaseCreate()
    await expect.poll(() => answerRequested).toBe(true)
    await expect(page.locator('.user-message')).toHaveCount(1)
    await expect(page.locator('.thinking')).toBeVisible()
    releaseAnswer()
    await expect(page.locator('.assistant-message')).toHaveCount(1)
    await expect(page.locator('.user-message')).toHaveCount(1)
    await expect(composer(page)).toBeEnabled()
  } finally { releaseCreate(); releaseAnswer() }
})

test('profile opens account settings in the same page and preserves the current chat', async ({ page }) => {
  await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  await send(page,'Keep this conversation open')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  const originalUrl = page.url()
  const profile = page.getByRole('button', { name: 'Open account settings', exact: true })
  await profile.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Account settings', exact: true })).toBeFocused()
  await expect(page.getByLabel('Account email')).toHaveValue(user.email)
  await expect(page.getByLabel('Account email')).toHaveAttribute('readonly','')
  expect(page.url()).toBe(originalUrl)
  expect(page.context().pages()).toHaveLength(1)
  await page.getByRole('button', { name: 'Back to research', exact: true }).click()
  await expect(page.locator('.user-message')).toContainText('Keep this conversation open')
  await expect(page.locator('.assistant-message')).toHaveCount(1)
  await profile.click()
  await page.locator('.account-settings-page').getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
})

test('opening Paper Library from notifications closes the activity popup', async ({ page }) => {
  await backend(page)
  await page.goto('/')
  await expect(composer(page)).toBeEnabled()
  const menu = page.locator('.activity-menu')
  await menu.locator('summary').click()
  await expect(menu).toHaveAttribute('open','')
  await menu.getByRole('button', { name: 'View paper library' }).click()
  await expect(page.getByRole('heading', { name: 'My Papers.', exact: true })).toBeVisible()
  await expect(menu).not.toHaveAttribute('open','')
  await expect(menu.getByRole('button', { name: 'View paper library' })).not.toBeVisible()
  await menu.locator('summary').click()
  await expect(menu.getByRole('button', { name: 'View paper library' })).toBeVisible()
  await menu.getByRole('button', { name: 'View paper library' }).click()
  await expect(menu).not.toHaveAttribute('open','')
})
