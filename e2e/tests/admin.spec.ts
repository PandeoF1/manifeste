import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route(/openfreemap|fonts\.(googleapis|gstatic)/, (route) => route.abort())
})

const PASSWORD = 'correct horse battery staple'

test('the admin asks for a sign-in, refuses a wrong password, accepts the right one', async ({
  page,
}) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()
  await page.getByLabel('Email').fill('moderator@example.org')
  await page.getByLabel('Mot de passe').fill('not the password')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toContainText('Identifiants invalides')
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { name: 'Modération' })).toBeVisible()
})

test('a moderator sees the queue and only the tabs of their role', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Email').fill('moderator@example.org')
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  const nav = page.getByRole('navigation', { name: 'Sections' })
  await expect(nav.getByRole('link', { name: /Modération/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Stats' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Sources' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Réglages' })).toHaveCount(0)
  // The seeded on-site report waits for a decision.
  await expect(page.getByText('Lycée Curie')).toBeVisible()
  await page.getByRole('button', { name: 'Valider' }).first().click()
  await expect(page.getByText('Aucun signal en attente.')).toBeVisible()
})

test('an admin tab asked for by a moderator falls back to their first tab', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Email').fill('moderator@example.org')
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { name: 'Modération' })).toBeVisible()
  await page.goto('/admin?tab=reglages')
  await expect(page.getByRole('heading', { name: 'Modération' })).toBeVisible()
  await expect(page.getByText('Durée du direct')).toHaveCount(0)
})

test.describe('an admin', () => {
  test.beforeEach(async ({ context }) => {
    const { readFile } = await import('node:fs/promises')
    const cookies = JSON.parse(
      await readFile(new URL('../.auth/admin.json', import.meta.url), 'utf8'),
    )
    await context.addCookies(cookies)
  })

  test('opens on the pipeline: circuit, funnel, lanes, source health and the live log', async ({
    page,
  }, info) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Circuit du pipeline/ })).toBeVisible()
    await expect(page.getByRole('list', { name: /Entonnoir/ })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Santé des sources' })).toBeVisible()
    await expect(page.getByRole('log')).toContainText('Lycée Pasteur')
    await expect(
      page.getByRole('button', { name: /Files à surveiller|En échec/ }).first(),
    ).toBeVisible()
    await page.screenshot({ path: info.outputPath('pipeline.png'), fullPage: true })
  })

  test('sees every tab and a dry run says what it would do without doing it', async ({ page }) => {
    await page.goto('/admin?tab=pipeline')
    const nav = page.getByRole('navigation', { name: 'Sections' })
    for (const name of ['Sources', 'Réglages', 'Journal', 'Équipe', 'Juge'])
      await expect(nav.getByRole('link', { name })).toBeVisible()
    await page.getByRole('button', { name: /Relire les sources sur 3 jours/ }).click()
    await expect(page.getByText(/Simulation \(rien n'a été modifié\)/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lancer', exact: true })).toBeVisible()
  })

  test('settings show their defaults and the audit trail records a change', async ({ page }) => {
    await page.goto('/admin?tab=reglages')
    await expect(page.getByLabel(/Durée du direct/)).toHaveValue('5')
    await page.getByLabel(/Durée du direct/).fill('6')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByRole('status')).toContainText('Réglages enregistrés')
    await page.goto('/admin?tab=journal')
    await expect(page.getByText('settings.set').first()).toBeVisible()
  })

  test('sources: the preset catalogue and the health of a source', async ({ page }) => {
    await page.goto('/admin?tab=sources')
    await expect(page.getByText('Journal').first()).toBeVisible()
    await expect(page.getByText(/Sources prêtes à l'emploi/)).toBeVisible()
  })
})
