import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const HEADER =
  'Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation'

/** Waits for React to hydrate the page, so typed input is not lost. */
async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="search"]')
    return (
      !!input && Object.keys(input).some((key) => key.startsWith('__react'))
    )
  })
}

test.describe('Export CSV des opérations', () => {
  test('exporte uniquement les opérations filtrées', async ({ page }) => {
    await page.goto('/')

    const rows = page.locator('tbody tr')
    await expect(rows.first()).toBeVisible()
    await waitForHydration(page)

    const summary = page.getByText(/^\d+ opérations? · Solde/)
    const totalCount = async () =>
      Number((await summary.innerText()).trim().split(' ')[0])

    // Filter on the first row's simplified label so the export is a subset of
    // the loaded operations, whatever the database contains.
    const label = (await rows.first().locator('td').nth(1).innerText()).trim()
    const initialCount = await totalCount()
    await page.getByPlaceholder('Rechercher…').fill(label)
    await expect.poll(totalCount).toBeLessThan(initialCount)

    const filteredCount = await totalCount()
    expect(filteredCount).toBeGreaterThan(0)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exporter CSV' }).click(),
    ])

    expect(download.suggestedFilename()).toMatch(
      /^operations-\d{4}-\d{2}-\d{2}\.csv$/,
    )

    const path = await download.path()
    expect(path).not.toBeNull()
    const content = await readFile(path!, 'latin1')
    const lines = content.split('\r\n')

    expect(lines[0]).toBe(HEADER)
    expect(lines.slice(1)).toHaveLength(filteredCount)
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^\d{2}\/\d{2}\/\d{4};/)
      expect(line.split(';').length).toBeGreaterThanOrEqual(13)
    }
  })
})
