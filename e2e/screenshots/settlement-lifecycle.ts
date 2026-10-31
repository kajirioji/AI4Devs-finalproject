// Screenshots of paying, unpaying and undoing an attempt for the PR of settlement-lifecycle (task 7.4). Not a test: it
// is outside the features of playwright-bdd, so `pnpm test:e2e` does not pick it up, and no CI job runs it. It needs the
// app and the API the person starts (`pnpm db:up`, `pnpm db:seed`, `pnpm dev`) and attempt 2 of batch 123 of ProviderA-USD
// processed (`pnpm test:api` leaves it). It WRITES: it pays, unpays and undoes that attempt, so `pnpm db:seed` afterwards
// leaves the world as it was. Same protections as web-settlement: the password comes from the root .env at run time, is
// set from the page, the field is emptied right after signing in, there is no trace nor video, and nothing is captured
// before the attempt is on screen.
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, expect, type Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'
const OUT = fileURLToPath(new URL('../../docs/wireframes/settlement-lifecycle/', import.meta.url))

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

/** The attempt the batch-clean flow of the collection leaves: pending payment, with an undone attempt 1. */
const ATTEMPT = 'Batch 123 · attempt 2'

/** Sets the value of the password field from the page, so no log carries it. */
async function setPassword(page: Page, value: string) {
  await page.getByLabel('Password').evaluate((input, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** Empties the password field, whatever happened to the click. */
async function clearPassword(page: Page) {
  await page
    .evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="password"]')
      if (!input) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    .catch(() => {})
}

async function signIn(page: Page, userName: string) {
  const password = process.env.SEED_PASSWORD
  if (!password) throw new Error('SEED_PASSWORD is not set: copy .env.example to .env at the repository root.')
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel('User name').fill(userName)
  await setPassword(page, password)
  try {
    await page.getByRole('button', { name: 'Sign in' }).click()
  } finally {
    await clearPassword(page)
  }
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

async function openAttempt(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settlement List' }).click()
  await page.getByLabel('Merchant').selectOption({ label: 'Merchant A' })
  await page.getByLabel('Provider').selectOption({ label: 'Provider A' })
  await page.getByLabel('Account').selectOption({ label: 'ProviderA-USD' })
  const link = page.getByRole('table', { name: 'Settlements' }).getByRole('link', { name: ATTEMPT })
  await expect(page.getByRole('table', { name: 'Settlements' })).toBeVisible()
  if (!(await link.isVisible())) {
    throw new Error('Attempt 2 of batch 123 is not in the list: run `pnpm test:api` on a fresh seed first.')
  }
  await link.click()
  await expect(page.getByRole('heading', { name: 'Settlement Summary · batch 123' })).toBeVisible()
  // The list arrives after the heading and pushes the page down: a capture before it would be cut short.
  await expect(page.getByRole('region', { name: 'Attempts of this import' })).toBeVisible()
}

/** A dialog only veils the viewport, so its capture stays within it. */
async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage })
  console.log(`saved docs/wireframes/settlement-lifecycle/${name}.png`)
}

async function withReason(page: Page, reason: string, name: string) {
  const dialog = page.getByRole('alertdialog')
  await dialog.getByLabel('Reason').fill(reason)
  await shot(page, name, false)
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  await expect(dialog).toBeHidden()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: false })
  try {
    const payments = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    payments.context().setDefaultTimeout(15_000)
    await signIn(payments, 'payments')
    await openAttempt(payments)
    await shot(payments, 'processed-payments')
    await payments.getByRole('button', { name: 'Mark as paid' }).click()
    await expect(payments.getByRole('button', { name: 'Unpay…' })).toBeVisible()
    await shot(payments, 'paid-payments')

    const analyst = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    analyst.context().setDefaultTimeout(15_000)
    await signIn(analyst, 'analyst')
    await openAttempt(analyst)
    await expect(analyst.getByRole('button', { name: 'Undo batch…' })).toBeDisabled()
    await shot(analyst, 'paid-analyst')

    await payments.getByRole('button', { name: 'Unpay…' }).click()
    await withReason(payments, 'Payment was rejected by the bank', 'unpay-dialog')
    await expect(payments.getByRole('button', { name: 'Mark as paid' })).toBeVisible()

    await analyst.reload()
    await analyst.getByRole('button', { name: 'Undo batch…' }).click()
    await withReason(analyst, 'Wrong settlement date', 'undo-dialog')
    await expect(analyst.getByRole('link', { name: 'Go to Analysis & Validations' })).toBeVisible()
    await shot(analyst, 'undone-analyst')

    await analyst.getByRole('link', { name: 'Go to Analysis & Validations' }).click()
    await expect(analyst.getByRole('region', { name: 'Review invalidated' })).toBeVisible()
    await shot(analyst, 'analysis-after-undo')
  } finally {
    await browser.close()
  }
}

await main()
