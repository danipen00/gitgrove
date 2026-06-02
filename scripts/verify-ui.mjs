// Launches the built Electron app with Playwright, seeds this repo as a recent,
// opens it, and screenshots the Changes (tree + diff) and History views.
import { _electron as electron } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const projectDir = process.cwd()
// Write screenshots outside the repo so they don't churn the working tree.
const shots = join(tmpdir(), 'gitgrove-shots')
mkdirSync(shots, { recursive: true })

const app = await electron.launch({ args: ['.'], cwd: projectDir })
const win = await app.firstWindow()

const errors = []
win.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
win.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})

await win.waitForLoadState('domcontentloaded')

// Seed recents into the real userData dir and reload so Welcome shows it.
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
writeFileSync(
  join(userData, 'recent-repos.json'),
  JSON.stringify([{ path: projectDir, name: 'gitgrove', lastOpened: Date.now() }], null, 2)
)
await win.reload()
await win.waitForSelector('.welcome', { timeout: 15000 })
await win.waitForTimeout(400)
await win.screenshot({ path: join(shots, '1-welcome.png') })
console.log('captured welcome')

// Open the repo via the recent row (no native dialog needed).
await win.waitForSelector('.recent-row', { timeout: 8000 })
await win.click('.recent-row')

// Wait for the sidebar + the diff viewer to mount, then for Pierre to paint.
await win.waitForSelector('.sidebar', { timeout: 15000 })
await win.waitForSelector('.tree-wrap', { timeout: 15000 })
await win.waitForTimeout(2500)
await win.screenshot({ path: join(shots, '2-changes.png') })
console.log('captured changes view')

// Report what actually rendered inside the panels.
const treeTag = await win.evaluate(() => {
  const el = document.querySelector('.tree-wrap')?.firstElementChild
  return el ? el.tagName.toLowerCase() : null
})
const diffTag = await win.evaluate(() => {
  const el = document.querySelector('.diff-body')
  return el ? el.innerHTML.slice(0, 120) : null
})
const diffText = await win.evaluate(() => document.querySelector('.diff-body')?.textContent?.slice(0, 80))
console.log('tree element:', treeTag)
console.log('diff body head:', diffTag)
console.log('diff text sample:', JSON.stringify(diffText))

// Switch to History and open the first commit.
await win.click('button.tab:has-text("History")')
await win.waitForSelector('.commit', { timeout: 10000 })
await win.click('.commit')
await win.waitForSelector('.commit-detail .tree-wrap', { timeout: 10000 })
await win.waitForTimeout(2500)
await win.screenshot({ path: join(shots, '3-history.png') })
const historyDiffName = await win.evaluate(
  () => document.querySelector('.diff-head__name')?.textContent
)
console.log('captured history view — diff header shows:', JSON.stringify(historyDiffName))

console.log('\nRENDER ERRORS:', errors.length ? errors : 'none')
await app.close()
