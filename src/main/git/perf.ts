/**
 * Dev-only perf logging gate: snapshot timings and slow git commands land in
 * the dev terminal. Set GITGROVE_PERF=1 to keep the logs in a packaged build.
 */
export const PERF = process.env.NODE_ENV !== 'production' || process.env.GITGROVE_PERF === '1'
