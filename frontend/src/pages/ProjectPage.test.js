import { describe, expect, it } from 'vitest'

import { NO_FILTERS, arrangeClaims } from './ProjectPage.jsx'

const claim = (id, category, priority, status) => ({ id, category, priority, status })

const CLAIMS = [
  claim(1, 'docs', 'low', 'true'),
  claim(2, 'security', 'high', 'false'),
  claim(3, 'tests', 'medium', 'partly_true'),
  claim(4, 'docs', 'high', 'true'),
]

const ids = (rows) => rows.map((a) => a.id)

const sorted = (col, dir = 'asc', filters = NO_FILTERS) =>
  ids(arrangeClaims(CLAIMS, { col, dir }, filters))

describe('arrangeClaims sorting', () => {
  it('runs status from false up to true, severity first inside a verdict', () => {
    expect(sorted('status')).toEqual([2, 3, 4, 1])
  })

  it('reverses on a second click of the same column', () => {
    expect(sorted('status', 'desc')).toEqual([4, 1, 3, 2])
  })

  it('puts the highest severity first, then falls back to status', () => {
    expect(sorted('severity')).toEqual([2, 4, 3, 1])
  })

  it('sorts categories alphabetically', () => {
    expect(sorted('category')).toEqual([4, 1, 2, 3])
  })

  it('leads with the newest claim', () => {
    expect(sorted('claim')).toEqual([4, 3, 2, 1])
  })

  it('leaves the input untouched', () => {
    arrangeClaims(CLAIMS, { col: 'claim', dir: 'asc' }, NO_FILTERS)
    expect(ids(CLAIMS)).toEqual([1, 2, 3, 4])
  })
})

describe('arrangeClaims filtering', () => {
  it('keeps only one category', () => {
    expect(sorted('claim', 'asc', { ...NO_FILTERS, category: 'docs' })).toEqual([4, 1])
  })

  it('keeps only one severity', () => {
    expect(sorted('claim', 'asc', { ...NO_FILTERS, severity: 'high' })).toEqual([4, 2])
  })

  it('keeps only one status', () => {
    expect(sorted('claim', 'asc', { ...NO_FILTERS, status: 'true' })).toEqual([4, 1])
  })

  it('intersects the column filters', () => {
    expect(sorted('claim', 'asc', { category: 'docs', severity: 'high', status: 'true' })).toEqual(
      [4],
    )
  })

  it('treats a missing status as queued', () => {
    const rows = arrangeClaims([{ id: 9, category: 'api', priority: 'low' }], { col: 'claim', dir: 'asc' }, { ...NO_FILTERS, status: 'queued' })
    expect(ids(rows)).toEqual([9])
  })
})
