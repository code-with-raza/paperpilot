import { test, expect } from '@playwright/test'

const paper = { paper_id: 'paper-1', filename: 'Attention_Is_All_You_Need.pdf', status: 'ready', created_at: '2026-10-29 12:00:00' }
const answer = 'Each attention head operates on a learned projection.\n\nSection: 3.2.2 Multi-Head Attention, Page: 4\n\nEvidence confidence: 92/100'

test('empty library presents an upload dialog and accessible keyboard dismissal', async ({ page }) => {
  await page.route('**/api/papers/?*', route => route.fulfill({ json: { papers: [] } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Big ideas begin with a paper.' })).toBeVisible()
  await page.getByRole('button', { name: 'Add your first paper' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close upload dialog' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.screenshot({ path: '../tmp/frontend-desktop.png', fullPage: true })
})

test('chat sends the existing API contract, displays real metadata, and saves and exports notes', async ({ page }) => {
  await page.route('**/api/papers/?*', route => route.fulfill({ json: { papers: [paper] } }))
  await page.route('**/api/papers/paper-1/ask', async route => {
    expect(route.request().postDataJSON()).toEqual({ user_id: 'default', question: 'Explain the main method' })
    await route.fulfill({ json: { answer } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Explain the main method' }).click()
  await expect(page.getByText('Each attention head operates on a learned projection.')).toBeVisible()
  await expect(page.getByText('92/100', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /3.2.2 Multi-Head Attention/ })).toBeVisible()
  await page.screenshot({ path: '../tmp/frontend-chat.png', fullPage: true })
  await page.getByLabel('Attach a local PDF for preview').setInputFiles({ name: paper.filename, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') })
  await page.getByRole('button', { name: /3.2.2 Multi-Head Attention/ }).click()
  await expect(page.locator('iframe')).toHaveAttribute('src', /#page=4$/)
  await page.getByRole('button', { name: 'Save answer as note' }).click()
  await page.getByRole('button', { name: /^Notes/ }).click()
  await expect(page.getByRole('article')).toContainText(answer)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Markdown' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('paperpilot-notes.md')
  await page.reload()
  await page.getByRole('button', { name: /^Notes/ }).click()
  await expect(page.getByRole('article')).toContainText('92/100')
})

test('PDF upload uses form fields and selects the resulting paper', async ({ page }) => {
  await page.route('**/api/papers/?*', route => route.fulfill({ json: { papers: [] } }))
  await page.route('**/api/uploadfile/', async route => {
    expect(route.request().headers()['content-type']).toContain('multipart/form-data')
    expect(route.request().postData()).toContain('name="user_id"\r\n\r\ndefault')
    expect(route.request().postData()).toContain('filename="my-research.pdf"')
    await route.fulfill({ json: { paper_id: 'new-paper', filename: 'my-research.pdf' } })
  })
  await page.goto('/')
  await page.getByLabel('Upload a research PDF').setInputFiles({ name: 'my-research.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') })
  await expect(page.getByRole('heading', { name: 'my-research', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain the main method' })).toBeEnabled()
})

test('failed questions preserve input and do not manufacture an answer', async ({ page }) => {
  await page.route('**/api/papers/?*', route => route.fulfill({ json: { papers: [paper] } }))
  await page.route('**/api/papers/paper-1/ask', route => route.fulfill({ status: 500, json: { detail: 'The model is temporarily unavailable.' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'What are the key findings?' }).click()
  await expect(page.getByRole('alert')).toContainText('The model is temporarily unavailable.')
  await expect(page.getByRole('textbox', { name: 'Question about your paper' })).toHaveValue('What are the key findings?')
  await expect(page.getByRole('button', { name: 'Save answer as note' })).toHaveCount(0)
})

test('mobile layout stays within viewport and navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/papers/?*', route => route.fulfill({ json: { papers: [paper] } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'What would you like to discover?' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '../tmp/frontend-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: /^My Papers/ }).click()
  await expect(page.getByRole('heading', { name: 'My Papers.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveCount(0)
})
