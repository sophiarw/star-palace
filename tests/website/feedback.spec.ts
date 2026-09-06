import { test, expect, type Page } from '@playwright/test'
import { emailFeedbackHtml, feedbackEndpoint } from '../../website/src/feedback'

const token = 'fixture_opaque_form_1234'
async function mockForm(page: Page) {
  // No test can send to a real provider, including native no-JavaScript submits.
  await page.route('https://formsubmit.co/**', route => route.abort())
  await page.route('http://127.0.0.1:5180/', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: emailFeedbackHtml(await response.text(), token) })
  })
}
const draft = async (page: Page) => {
  await page.getByLabel('A short summary').fill('A & B # café')
  await page.getByLabel('Tell us a little more').fill('My feedback <script>text stays text</script>.')
}

test('configuration refuses an email address or arbitrary service URL', () => {
  expect(feedbackEndpoint('')).toBeNull()
  for (const value of ['private@example.test', 'https://example.test/token', '../activation-link']) expect(() => feedbackEndpoint(value)).toThrow()
  expect(feedbackEndpoint(token)).toBe(`https://formsubmit.co/${token}`)
})

test('private feedback submits only once, includes optional reply email, and confirms acceptance', async ({ page }) => {
  await mockForm(page)
  let count = 0, body: Record<string, string> = {}
  await page.route(`https://formsubmit.co/ajax/${token}`, async route => {
    count++; body = route.request().postDataJSON()
    await new Promise(resolve => setTimeout(resolve, 300))
    await route.fulfill({ json: { success: 'true', message: 'Accepted' } })
  })
  await page.goto('/#feedback')
  await page.getByRole('button', { name: 'Send feedback' }).click()
  expect(count).toBe(0)
  await draft(page)
  await page.getByLabel('Your email').fill('visitor@example.test')
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.locator('#feedback-form')).toHaveAttribute('aria-busy', 'true')
  await page.locator('#feedback-form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await expect(page.locator('#feedback-status')).toHaveText('Thanks—your feedback was submitted.')
  expect(count).toBe(1)
  expect(body).toMatchObject({ summary: 'A & B # café', message: 'My feedback <script>text stays text</script>.', email: 'visitor@example.test', _subject: 'Star Palace feedback' })
  await expect(page.getByLabel('Tell us a little more')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeEnabled()
  await expect(page.locator('#feedback-form')).toHaveAttribute('action', `https://formsubmit.co/${token}`)
  await expect(page).toHaveURL(/#feedback$/)
})

test('network and provider failures retain the draft and never claim success', async ({ page }) => {
  await mockForm(page)
  let attempt = 0
  await page.route(`https://formsubmit.co/ajax/${token}`, async route => {
    if (attempt++ === 0) await route.abort()
    else await route.fulfill({ status: 200, json: { success: false, message: 'Rejected' } })
  })
  await page.goto('/#feedback'); await draft(page)
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Send feedback' }).click()
    await expect(page.locator('#feedback-status')).toContainText('Delivery could not be confirmed')
    await expect(page.getByLabel('A short summary')).toHaveValue('A & B # café')
    await expect(page.getByRole('button', { name: 'Send feedback' })).toBeEnabled()
  }
})

test('without JavaScript, feedback uses a native POST to the opaque form endpoint', async ({ browser }) => {
  const page = await browser.newPage({ javaScriptEnabled: false })
  await mockForm(page)
  let submitted = ''
  await page.route(`https://formsubmit.co/${token}`, async route => {
    expect(route.request().method()).toBe('POST'); submitted = route.request().postData() ?? ''
    await route.fulfill({ body: '<title>Provider confirmation</title>' })
  })
  await page.goto('http://127.0.0.1:5180/#feedback'); await draft(page)
  // Native implicit submit avoids depending on animated anchor scrolling.
  await page.getByLabel('A short summary').press('Enter')
  await expect.poll(() => submitted).not.toBe('')
  expect(new URLSearchParams(submitted).get('summary')).toBe('A & B # café')
  expect(new URLSearchParams(submitted).get('_captcha')).toBeNull()
  await page.close()
})
