import { describe, expect, it } from 'vitest'

import { PAGE_ROOT, appLocation, canvasPath } from './router.jsx'

describe('app paths as Canvas URLs', () => {
  it('puts the home page at the declared page root', () => {
    expect(canvasPath('/')).toBe(PAGE_ROOT)
  })

  it('hangs every other app path below it', () => {
    expect(canvasPath('/projects/acme/tools')).toBe(`${PAGE_ROOT}/projects/acme/tools`)
  })

  it('accepts a location object, search and hash included', () => {
    expect(canvasPath({ pathname: '/projects/acme/tools', search: '?a=1', hash: '#x' })).toBe(
      `${PAGE_ROOT}/projects/acme/tools?a=1#x`,
    )
  })
})

describe('the route remainder as an app location', () => {
  it('reads the page root itself as home', () => {
    expect(appLocation('')).toMatchObject({ pathname: '/', search: '', hash: '' })
  })

  it('restores the leading slash the host strips', () => {
    expect(appLocation('projects/acme/tools')).toMatchObject({
      pathname: '/projects/acme/tools',
    })
  })

  it('keeps search and hash apart from the pathname', () => {
    expect(appLocation('projects/acme/tools?a=1#x')).toMatchObject({
      pathname: '/projects/acme/tools',
      search: '?a=1',
      hash: '#x',
    })
  })
})
