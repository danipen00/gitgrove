// Renders the source icon (src/renderer/src/assets/icon.svg — the single
// hand-edited source of truth, also imported by the About dialog) to
// build/icon.png at 1024x1024 using the Playwright Chromium that already ships
// as a devDependency. electron-builder turns that single PNG into the platform
// .icns / .ico at build time. build/icon.png is the only generated artifact.
//
//   bun run scripts/make-icon.mjs
//
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const sourceSvg = resolve(here, '../src/renderer/src/assets/icon.svg')
const buildDir = resolve(here, '../build')
const svg = readFileSync(sourceSvg, 'utf8')
const SIZE = 1024

const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1
  })
  // Transparent page so the icon's rounded corners stay see-through.
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
    { waitUntil: 'networkidle' }
  )
  const buf = await page.screenshot({ omitBackground: true, type: 'png' })
  writeFileSync(resolve(buildDir, 'icon.png'), buf)
  console.log(`Wrote build/icon.png (${SIZE}x${SIZE}, ${buf.length} bytes)`)
} finally {
  await browser.close()
}
