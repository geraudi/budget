import { expect, test } from '@playwright/test'

test.describe('Page Opérations', () => {
  test('affiche la navigation et le tableau des opérations', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('Budget')
    await expect(page.getByRole('link', { name: 'Opérations', exact: true })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Opérations récurrentes', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible()

    await expect(page.getByText('Opérations', { exact: true }).first()).toBeVisible()
    await expect(page.getByPlaceholder('Rechercher…')).toBeVisible()
  })

  test('filtre les opérations par période', async ({ page }) => {
    await page.goto('/')
    await page.locator('main[data-hydrated]').waitFor()

    await page.getByRole('button', { name: 'Période', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Filtrer la période')).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Mensuelle', pressed: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Annuelle', pressed: false }),
    ).toBeVisible()

    const apply = dialog.getByRole('button', { name: 'Appliquer' })
    await expect(apply).toBeDisabled()

    const month = dialog
      .getByRole('group', { name: 'Mois' })
      .locator('button[aria-pressed]:not([disabled])')
      .first()
    await month.click()
    await expect(apply).toBeEnabled()
    await apply.click()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Période', exact: true })).toBeHidden()

    // Reopening exposes the active filter so it can be cleared.
    await page.locator('button[aria-haspopup="dialog"]').click()
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Effacer' }),
    ).toBeVisible()
  })

  test('affiche l’historique d’une opération', async ({ page }) => {
    await page.goto('/')
    await page.locator('main[data-hydrated]').waitFor()

    await page.getByRole('button', { name: 'Historique' }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: "Historique de l'opération" }),
    ).toBeVisible()
    await expect(dialog.getByText('Importation').first()).toBeVisible()

    await dialog.getByRole('button', { name: 'Fermer' }).click()
    await expect(dialog).toBeHidden()
  })

  test('navigue vers les opérations récurrentes', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Opérations récurrentes' }).click()

    await expect(page).toHaveURL(/\/recurrentes$/)
    await expect(page.getByText('Opérations récurrentes').first()).toBeVisible()
  })

  test('navigue vers le dashboard', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Dashboard' }).click()

    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
