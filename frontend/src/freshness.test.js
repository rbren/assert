import { describe, expect, it } from 'vitest'

import { freshness, parseUTC, timeAgo } from './freshness'

const NOW = Date.parse('2026-06-01T12:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString().replace('Z', '')
const DAY = 24 * 60 * 60 * 1000

const run = (behind, agoMs) => ({
  commits_behind: behind,
  finished_at: ago(agoMs),
  created_at: ago(agoMs),
})

describe('freshness levels', () => {
  it('is fresh at head no matter how old', () => {
    expect(freshness(run(0, 400 * DAY), NOW).level).toBe('fresh')
  })

  it('drifts as soon as one commit lands', () => {
    expect(freshness(run(1, 60 * 1000), NOW).level).toBe('drifting')
  })

  it('stays amber when far behind but recent', () => {
    expect(freshness(run(500, 2 * DAY), NOW).level).toBe('drifting')
  })

  it('stays amber when old but barely behind', () => {
    expect(freshness(run(3, 90 * DAY), NOW).level).toBe('drifting')
  })

  it('goes red only when old AND well behind', () => {
    expect(freshness(run(11, 8 * DAY), NOW).level).toBe('stale')
  })

  it('holds the boundary: exactly 10 commits and 7 days is not yet red', () => {
    expect(freshness(run(10, 7 * DAY), NOW).level).toBe('drifting')
  })

  it('reports nothing when the backend could not count commits', () => {
    expect(freshness({ commits_behind: null, created_at: ago(0) }, NOW)).toBeNull()
    expect(freshness(null, NOW)).toBeNull()
  })
})

describe('parseUTC', () => {
  it('treats naive API timestamps as UTC rather than local', () => {
    expect(parseUTC('2026-06-01T12:00:00').toISOString()).toBe('2026-06-01T12:00:00.000Z')
  })

  it('leaves an explicit zone alone', () => {
    expect(parseUTC('2026-06-01T12:00:00Z').toISOString()).toBe('2026-06-01T12:00:00.000Z')
  })
})

describe('timeAgo', () => {
  const cases = [
    [30 * 1000, 'just now'],
    [5 * 60 * 1000, '5m ago'],
    [3 * 60 * 60 * 1000, '3h ago'],
    [5 * DAY, '5d ago'],
    [90 * DAY, '3mo ago'],
    [800 * DAY, '2y ago'],
  ]
  it.each(cases)('renders %i ms as %s', (msAgo, expected) => {
    expect(timeAgo(new Date(NOW - msAgo), NOW)).toBe(expected)
  })

  it('never reports a future check as negative', () => {
    expect(timeAgo(new Date(NOW + 60_000), NOW)).toBe('just now')
  })
})
