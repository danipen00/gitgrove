// Verifies the light theme + theme selector: opens this repo, screenshots the
// default (dark) diff, switches to Light via the theme menu, and screenshots again.

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const projectDir = process.cwd()
const shots = join(tmpdir(), 'gitgrove-shots')
mkdirSync(shots, { recursive: true })

const app = await electron.launch({ args: ['.'], cwd: projectDir })
const win = await app.firstWindow()

const errors = []
win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
win.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await win.waitForLoadState('domcontentloaded')
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
writeFileSync(
  join(userData, 'recent-repos.json'),
  JSON.stringify([{ path: projectDir, name: 'gitgrove', lastOpened: Date.now() }], null, 2)
)
await win.reload()
await win.waitForSelector('.recent-row', { timeout: 15000 })
await win.click('.recent-row')

await win.waitForSelector('.diff-body', { timeout: 15000 })
await win.waitForTimeout(2500)

async function pick(label) {
  await win.locator('header.toolbar button[title="Theme"]').click()
  await win.waitForSelector('.popover', { timeout: 5000 })
  await win.click(`.popover__item:has-text("${label}")`)
  await win.waitForTimeout(2500)
  const resolved = await win.evaluate(() => document.documentElement.dataset.theme)
  const bodyBg = await win.evaluate(() => getComputedStyle(document.body).backgroundColor)
  console.log(`picked ${label} -> resolved=${resolved} body bg=${bodyBg}`)
  return resolved
}

await pick('Light')
await win.screenshot({ path: join(shots, 'theme-light.png') })

await pick('Dark')
await win.screenshot({ path: join(shots, 'theme-dark.png') })

console.log('\nshots dir:', shots)
console.log('RENDER ERRORS:', errors.length ? errors : 'none')
await app.close()
