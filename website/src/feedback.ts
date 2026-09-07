export function feedbackEndpoint(id: string): string | null {
  if (!id) return null
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(id)) throw new Error('Feedback requires an opaque form ID, never an email address or verification link.')
  return `https://formsubmit.co/${id}`
}

/** Build both the native HTML form and its progressive enhancement from one ID. */
export function emailFeedbackHtml(html: string, id: string): string {
  const endpoint = feedbackEndpoint(id)
  if (!endpoint) return html // Keep the existing public-issue flow until email is verified.
  return html.replace(/<!-- feedback:start -->[\s\S]*?<!-- feedback:end -->/, `
<!-- feedback:start -->
<section class="feedback-section wrap section" id="feedback" aria-labelledby="feedback-title">
  <div><p class="eyebrow">Notes / Requests</p><h2 id="feedback-title">Feedback</h2>
    <p>Bugs, questions, feature requests.</p>
    <p class="small">Delivery: email. <a href="https://formsubmit.co/privacy.pdf">FormSubmit</a> processes delivery and retains submissions for 30 days. Omit private filenames and file contents.</p>
  </div>
  <form id="feedback-form" action="${endpoint}" method="post" data-email-feedback="true">
    <input type="hidden" name="_subject" value="Star Palace feedback" />
    <input type="hidden" name="_template" value="table" />
    <input type="hidden" name="_url" value="https://starpalace.ai/" />
    <input type="hidden" name="_next" value="https://starpalace.ai/?feedback=submitted#feedback" />
    <div hidden><label>Leave this empty<input name="_honey" tabindex="-1" autocomplete="off" /></label></div>
    <label for="feedback-kind">Category</label>
    <select id="feedback-kind" name="kind"><option>Bug</option><option>Feature request</option><option>Question</option></select>
    <label for="feedback-summary">Subject</label>
    <input id="feedback-summary" name="summary" required maxlength="120" placeholder="Subject" />
    <label for="feedback-message">Message</label>
    <textarea id="feedback-message" name="message" required minlength="10" maxlength="2500" rows="4" placeholder="Details, steps, or a question."></textarea>
    <label for="feedback-email">Reply email <span class="small">(optional)</span></label>
    <input id="feedback-email" name="email" type="email" maxlength="254" autocomplete="email" />
    <button class="button primary" type="submit">Send feedback</button>
    <p class="small" id="feedback-status" role="status" aria-live="polite">Reply address: optional.</p>
  </form>
</section>
<!-- feedback:end -->`).replace('To send feedback, <a href="https://github.com/sophiarw/star-palace/issues/new">open a GitHub issue</a>.', 'The feedback form also works without JavaScript.')
}

export function setupEmailFeedback(form: HTMLFormElement): void {
  const status = form.querySelector<HTMLElement>('#feedback-status')!
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  if (new URLSearchParams(location.search).get('feedback') === 'submitted') status.textContent = 'Your submission has returned from FormSubmit. Thank you.'
  let pending = false
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (pending || !form.reportValidity()) return
    const data = new FormData(form)
    if (data.get('_honey')) return
    const endpoint = new URL(form.action)
    // Only the opaque-ID provider endpoint configured in the public HTML is valid.
    if (endpoint.href !== feedbackEndpoint(endpoint.pathname.slice(1))) return
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
    const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input,select,textarea,button'))
    const payload: Record<string, string> = {}
    data.forEach((value, key) => { if (typeof value === 'string') payload[key] = value })
    const disabled = controls.map(control => control.disabled)
    pending = true; controls.forEach(control => { control.disabled = true }); form.setAttribute('aria-busy', 'true')
    button.textContent = 'Sending…'; status.textContent = 'Sending your feedback…'
    try {
      const response = await fetch(`${endpoint.origin}/ajax${endpoint.pathname}`, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      })
      const result = await response.json() as { success?: boolean | string }
      if (!response.ok || (result.success !== true && result.success !== 'true')) throw new Error('Unconfirmed submission')
      form.reset(); status.textContent = 'Thanks—your feedback was submitted.'
    } catch {
      status.textContent = 'Delivery could not be confirmed. Your message is still here; please try again later.'
    } finally {
      clearTimeout(timeout); pending = false; form.removeAttribute('aria-busy')
      controls.forEach((control, i) => { control.disabled = disabled[i] }); button.textContent = 'Send feedback'
    }
  })
}
