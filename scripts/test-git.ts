// Smoke test for the main-process git layer, run against a real repo path.
// Usage: bun scripts/test-git.ts [repoPath]
import {
  getBranches,
  getCommitDiff,
  getCommitFiles,
  getLog,
  getStatus,
  getSummary,
  getWorkingDiff,
  resolveRepoRoot
} from '../src/main/git'

const repo = process.argv[2] ?? process.cwd()

function head(label: string, text: string, lines = 6) {
  console.log(`\n=== ${label} ===`)
  console.log(text.split('\n').slice(0, lines).join('\n'))
}

const root = await resolveRepoRoot(repo)
if (!root) throw new Error('not a repo')
console.log('repo root:', root)

const summary = await getSummary(root)
console.log(
  'summary:',
  JSON.stringify({
    name: summary.name,
    branch: summary.branch.current,
    changes: summary.changeCount,
    ahead: summary.ahead,
    behind: summary.behind
  })
)

const branches = await getBranches(root)
console.log('branches:', branches.local, '| remotes:', branches.remote.length)

const status = await getStatus(root)
console.log(
  'status files:',
  status.map((f) => `${f.status}:${f.path}${f.staged ? '(staged)' : ''}`)
)

if (status.length) {
  const wd = await getWorkingDiff(root, status[0])
  head(`working diff for ${wd.path} (binary=${wd.binary}, notice=${wd.notice ?? '-'})`, wd.patch)
}

const log = await getLog(root, { limit: 5 })
console.log('\n=== log ===')
for (const c of log)
  console.log(
    `${c.shortHash} ${c.subject} — ${c.authorName} (${c.relativeDate}) parents=${c.parents.length}`
  )

if (log.length) {
  const target = log[log.length - 1] // oldest in window; test root if it is one
  const files = await getCommitFiles(root, target.hash)
  console.log(`\n=== commit files for ${target.shortHash} ===`)
  console.log(
    files.map((f) => `${f.status}:${f.path} +${f.insertions ?? '?'} -${f.deletions ?? '?'}`)
  )
  if (files.length) {
    const cd = await getCommitDiff(root, target.hash, files[0])
    head(`commit diff for ${cd.path} (binary=${cd.binary})`, cd.patch)
  }
}

console.log('\nAll git layer calls completed OK.')
