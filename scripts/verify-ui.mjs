// Launches the built Electron app with Playwright, seeds this repo as a recent,
// opens it, and screenshots the Changes (tree + diff) and History views.

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const projectDir = process.cwd()
// Write screenshots outside the repo so they don't churn the working tree.
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

// Git-availability gate: if git couldn't be located the app shows the setup
// screen (.git-setup) instead of the recents list, and the run below can't
// proceed. Fail loudly with a clear reason rather than timing out on a click.
const onGitSetup = await win.evaluate(() => !!document.querySelector('.git-setup'))
if (onGitSetup) {
  await win.screenshot({ path: join(shots, '0-git-setup.png') })
  console.error('Git was not detected — app is on the setup screen. Aborting.')
  await app.close()
  process.exit(1)
}
console.log('git detected — setup screen not shown')

// Open the repo via the recent row (no native dialog needed).
await win.waitForSelector('.recent-row', { timeout: 8000 })
await win.click('.recent-row')

// Wait for the sidebar + the changes panel to mount (the working file list
// when the repo is dirty, the clean-tree state otherwise), then for Pierre
// to paint.
await win.waitForSelector('.sidebar', { timeout: 15000 })
await win.waitForSelector('.wfl, .changes .center-state', { timeout: 15000 })
await win.waitForTimeout(2500)
await win.screenshot({ path: join(shots, '2-changes.png') })
console.log('captured changes view')

// Report what actually rendered inside the panels.
const treeTag = await win.evaluate(() => {
  const el = document.querySelector('.wfl, .changes .center-state')
  return el ? `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}` : null
})
const diffTag = await win.evaluate(() => {
  const el = document.querySelector('.diff-body')
  return el ? el.innerHTML.slice(0, 120) : null
})
const diffText = await win.evaluate(() =>
  document.querySelector('.diff-body')?.textContent?.slice(0, 80)
)
console.log('tree element:', treeTag)
console.log('diff body head:', diffTag)
console.log('diff text sample:', JSON.stringify(diffText))

// Switch to History and open the first commit.
await win.click('button.tab:has-text("History")')
await win.waitForSelector('.commit', { timeout: 10000 })
await win.click('.commit')
await win.waitForSelector('.history-pane--files .tree-wrap', { timeout: 10000 })
await win.waitForTimeout(2500)
await win.screenshot({ path: join(shots, '3-history.png') })
const historyDiffName = await win.evaluate(
  () => document.querySelector('.diff-head__name')?.textContent
)
console.log('captured history view — diff header shows:', JSON.stringify(historyDiffName))

console.log('\nRENDER ERRORS:', errors.length ? errors : 'none')
await app.close()
