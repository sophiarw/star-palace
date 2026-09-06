import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { FEEDBACK_FORM_ID } from './website/feedback.config'
import { emailFeedbackHtml } from './website/src/feedback'
export default defineConfig({
  root: 'website',
  plugins: [{ name: 'private-feedback-form', transformIndexHtml: html => emailFeedbackHtml(html, FEEDBACK_FORM_ID) }],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: { outDir: '../dist-site', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5180 },
})
