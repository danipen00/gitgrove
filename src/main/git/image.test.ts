import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageMimeType } from './image'
import { getCommitDiff, getCommitFiles, getWorkingDiff } from './read'

describe('imageMimeType', () => {
  test('maps every renderable extension to its MIME type', () => {
    expect(imageMimeType('logo.png')).toBe('image/png')
    expect(imageMimeType('photo.jpg')).toBe('image/jpeg')
    expect(imageMimeType('photo.jpeg')).toBe('image/jpeg')
    expect(imageMimeType('photo.jfif')).toBe('image/jpeg')
    expect(imageMimeType('anim.gif')).toBe('image/gif')
    expect(imageMimeType('anim.apng')).toBe('image/apng')
    expect(imageMimeType('modern.webp')).toBe('image/webp')
    expect(imageMimeType('modern.avif')).toBe('image/avif')
    expect(imageMimeType('old.bmp')).toBe('image/bmp')
    expect(imageMimeType('favicon.ico')).toBe('image/x-icon')
    expect(imageMimeType('icon.svg')).toBe('image/svg+xml')
  })

  test('is case-insensitive (assets arrive as IMG_0042.JPG)', () => {
    expect(imageMimeType('IMG_0042.JPG')).toBe('image/jpeg')
    expect(imageMimeType('Logo.PNG')).toBe('image/png')
    expect(imageMimeType('Icon.SvG')).toBe('image/svg+xml')
  })

  test('works on repo-relative paths with directories', () => {
    expect(imageMimeType('assets/icons/app.png')).toBe('image/png')
    expect(imageMimeType('a/b/c/d.webp')).toBe('image/webp')
  })

  test('rejects non-image and undisplayable formats', () => {
    expect(imageMimeType('readme.md')).toBeNull()
    expect(imageMimeType('photo.tiff')).toBeNull() // Chromium can't decode TIFF
    expect(imageMimeType('photo.psd')).toBeNull()
    expect(imageMimeType('photo.heic')).toBeNull()
    expect(imageMimeType('archive.tar.gz')).toBeNull()
  })

  test('rejects paths without a usable extension', () => {
    expect(imageMimeType('Makefile')).toBeNull()
    expect(imageMimeType('weird.')).toBeNull()
    expect(imageMimeType('.gitignore')).toBeNull()
    // A dot in a directory name is not an extension.
    expect(imageMimeType('assets.v2/logo')).toBeNull()
  })
})

// ── Integration: real git, throwaway repo ────────────────────────────────────
// Image blobs must round-trip byte-exact through `git show` (a utf8-decoding
// read would corrupt them) and ride on the regular diff payloads.

/** Tiny valid PNGs (1×1 red / 1×1 blue) — binary content with NUL bytes. */
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const BLUE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

let repo: string
let configHome: string
let firstHash: string
let secondHash: string

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'author@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'author@example.com'
    }
  }).trim()
}

beforeAll(() => {
  // Hermetic git: same isolation as read.test.ts, so a developer's global
  // config (diff drivers, attributes) can't leak into these assertions.
  configHome = mkdtempSync(join(tmpdir(), 'gitgrove-config-'))
  const emptyConfig = join(configHome, 'gitconfig')
  writeFileSync(emptyConfig, '')
  process.env.GIT_CONFIG_GLOBAL = emptyConfig
  process.env.GIT_CONFIG_SYSTEM = emptyConfig

  repo = mkdtempSync(join(tmpdir(), 'gitgrove-image-test-'))
  git(['init', '-b', 'main'])
  writeFileSync(join(repo, 'pixel.png'), RED_PNG)
  git(['add', '.'])
  git(['commit', '-m', 'add red pixel'])
  firstHash = git(['rev-parse', 'HEAD'])
  writeFileSync(join(repo, 'pixel.png'), BLUE_PNG)
  git(['add', '.'])
  git(['commit', '-m', 'turn it blue'])
  secondHash = git(['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(configHome, { recursive: true, force: true })
  delete process.env.GIT_CONFIG_GLOBAL
  delete process.env.GIT_CONFIG_SYSTEM
})

const fromDataUrl = (dataUrl: string): Buffer => {
  const [head, body] = dataUrl.split(',')
  expect(head).toBe('data:image/png;base64')
  return Buffer.from(body, 'base64')
}

describe('image sides on commit diffs', () => {
  test('an added image ships only the new side, byte-exact', async () => {
    const [file] = await getCommitFiles(repo, firstHash)
    const diff = await getCommitDiff(repo, firstHash, file)
    expect(diff.image).toBeDefined()
    expect(diff.image?.old).toBeNull()
    expect(diff.notice).toBeUndefined()
    expect(fromDataUrl(diff.image?.new?.dataUrl ?? '').equals(RED_PNG)).toBe(true)
    expect(diff.image?.new?.bytes).toBe(RED_PNG.byteLength)
  })

  test('a modified image ships both sides, byte-exact', async () => {
    const [file] = await getCommitFiles(repo, secondHash)
    const diff = await getCommitDiff(repo, secondHash, file)
    expect(fromDataUrl(diff.image?.old?.dataUrl ?? '').equals(RED_PNG)).toBe(true)
    expect(fromDataUrl(diff.image?.new?.dataUrl ?? '').equals(BLUE_PNG)).toBe(true)
  })

  test('a rename-only raster never ships text contents (no Code view)', async () => {
    // A 100% similarity rename diffs to just the rename header — no "Binary
    // files differ" line — which must not be mistaken for a diffable text
    // file (that would attach raw image bytes decoded as utf8).
    git(['mv', 'pixel.png', 'renamed.png'])
    git(['commit', '-m', 'rename pixel'])
    const renameHash = git(['rev-parse', 'HEAD'])
    try {
      const [file] = await getCommitFiles(repo, renameHash)
      expect(file.status).toBe('renamed')
      const diff = await getCommitDiff(repo, renameHash, file)
      expect(diff.image).toBeDefined()
      expect(fromDataUrl(diff.image?.old?.dataUrl ?? '').equals(BLUE_PNG)).toBe(true)
      expect(fromDataUrl(diff.image?.new?.dataUrl ?? '').equals(BLUE_PNG)).toBe(true)
      expect(diff.oldContents).toBeUndefined()
      expect(diff.newContents).toBeUndefined()
    } finally {
      git(['mv', 'renamed.png', 'pixel.png'])
      git(['commit', '-m', 'rename back'])
    }
  })
})

describe('image sides on working diffs', () => {
  test('an untracked image ships the working-tree bytes', async () => {
    writeFileSync(join(repo, 'fresh.png'), BLUE_PNG)
    try {
      const diff = await getWorkingDiff(repo, {
        path: 'fresh.png',
        status: 'untracked',
        staged: false
      })
      expect(diff.image?.old).toBeNull()
      expect(fromDataUrl(diff.image?.new?.dataUrl ?? '').equals(BLUE_PNG)).toBe(true)
      expect(diff.notice).toBeUndefined()
    } finally {
      rmSync(join(repo, 'fresh.png'), { force: true })
    }
  })

  test('a modified image diffs working tree against HEAD', async () => {
    writeFileSync(join(repo, 'pixel.png'), RED_PNG) // HEAD has blue
    try {
      const diff = await getWorkingDiff(repo, {
        path: 'pixel.png',
        status: 'modified',
        staged: false
      })
      expect(fromDataUrl(diff.image?.old?.dataUrl ?? '').equals(BLUE_PNG)).toBe(true)
      expect(fromDataUrl(diff.image?.new?.dataUrl ?? '').equals(RED_PNG)).toBe(true)
    } finally {
      writeFileSync(join(repo, 'pixel.png'), BLUE_PNG) // restore HEAD state
    }
  })

  test('a modified SVG keeps its text diff alongside the image sides', async () => {
    const oldSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>\n'
    const newSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>\n'
    writeFileSync(join(repo, 'icon.svg'), oldSvg)
    git(['add', 'icon.svg'])
    git(['commit', '-m', 'add icon'])
    writeFileSync(join(repo, 'icon.svg'), newSvg)
    const diff = await getWorkingDiff(repo, { path: 'icon.svg', status: 'modified', staged: false })
    expect(diff.image?.old).not.toBeNull()
    expect(diff.image?.new).not.toBeNull()
    // The Image ⇄ Code toggle needs the text diff too.
    expect(diff.patch).toContain('width="8"')
    expect(diff.oldContents).toBe(oldSvg)
    expect(diff.newContents).toBe(newSvg)
  })
})
