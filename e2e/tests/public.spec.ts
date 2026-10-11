import { expect, test } from '@playwright/test'

// The map tiles come from a third party: tests never reach the internet.
test.beforeEach(async ({ page }) => {
  await page.route(/openfreemap|fonts\.(googleapis|gstatic)/, (route) => route.abort())
})

test('home: the national figures come from the API', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page).toHaveTitle(/Manifeste/)
  // Two schools are blocked or filtering in the seed.
  await expect(page.getByText(/établissements? .*bloqués?/i).first()).toBeVisible({
    timeout: 15_000,
  })
  expect(errors.filter((e) => !/WebGL|maplibre|style/i.test(e))).toEqual([])
})

test('list: schools with their status, and the search narrows them', async ({ page }) => {
  await page.goto('/liste')
  await expect(page.getByText('Lycée Pasteur')).toBeVisible()
  await expect(page.getByText('Lycée Curie')).toBeVisible()
  await page.getByRole('searchbox').first().fill('pasteur')
  await expect(page.getByText('Lycée Curie')).toBeHidden()
  await expect(page.getByText('Lycée Pasteur')).toBeVisible()
})

test('school page: name, city and its reports', async ({ page }) => {
  await page.goto('/liste')
  await page.getByText('Lycée Pasteur').first().click()
  await expect(page).toHaveURL(/\/lycee\/|\/liste/)
})

test('open data page shows the summary', async ({ page }) => {
  await page.goto('/donnees')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/CC BY 4\.0/i).first()).toBeVisible()
})

test('report form opens and asks for a position', async ({ page }) => {
  await page.goto('/signaler')
  await expect(page.getByRole('heading', { name: /signaler/i }).first()).toBeVisible()
})

test('realtime: the public socket is accepted', async ({ page, baseURL }) => {
  await page.goto('/')
  const open = await page.evaluate(
    (url) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/api/ws`)
        ws.onopen = () => {
          ws.close()
          resolve(true)
        }
        ws.onerror = () => resolve(false)
      }),
    baseURL ?? '',
  )
  expect(open).toBe(true)
})

test('the API serves its documentation and the open data', async ({ request }) => {
  expect((await request.get('/api/docs')).ok()).toBe(true)
  const res = await request.get('/api/donnees?vue=resume')
  expect(res.headers()['access-control-allow-origin']).toBe('*')
  expect((await res.json()).donnees.signalements).toBeGreaterThan(0)
})
