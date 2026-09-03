/* How much a verdict has decayed since the evidence was gathered.
 *
 * Pure functions, kept out of the component file so the thresholds can be
 * exercised directly — they are a policy claim about when evidence stops being
 * trustworthy, which is exactly the kind of thing that should be testable. */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const STALE_COMMITS = 10

/* Timestamps come back naive-UTC from the API, so the Z is required or the
 * browser reads them as local and every age is off by the offset. */
export function parseUTC(s) {
  return s ? new Date(/[Z+]/.test(s) ? s : s + 'Z') : null
}

export function timeAgo(date, now = Date.now()) {
  if (!date) return null
  const secs = Math.max(0, (now - date.getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

/* Two independent kinds of drift make a verdict untrustworthy — commits landing
 * on top of it, and time simply passing — so both are measured. Red is reserved
 * for when they agree (old *and* well behind); either one alone is amber. A
 * verdict from an hour ago that is 40 commits behind is suspect but fresh; one
 * from a month ago on an untouched repo is old but still standing. */
export function freshness(run, now = Date.now()) {
  if (!run) return null
  const checked = parseUTC(run.finished_at || run.created_at)
  const behind = run.commits_behind
  const age = checked ? now - checked.getTime() : null
  if (behind == null) return null
  if (behind === 0) return { level: 'fresh', behind, checked, age }
  const old = age != null && age > WEEK_MS
  const wayBehind = behind > STALE_COMMITS
  return { level: old && wayBehind ? 'stale' : 'drifting', behind, checked, age }
}
