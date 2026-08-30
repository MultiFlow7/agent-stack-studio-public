import { describe, expect, it } from 'vitest'
import {
  sourceLocatorInputSchema,
  sourceOpenUrlInputSchema,
  sourceSearchInputSchema,
} from './source-discovery'

describe('source discovery IPC schemas', () => {
  it('accepts only bounded explicit search inputs', () => {
    expect(
      sourceSearchInputSchema.parse({
        provider: 'github',
        query: 'agent stack',
        sort: 'relevance',
        order: 'desc',
        page: 1,
        perPage: 10,
      }),
    ).toMatchObject({ provider: 'github', query: 'agent stack' })
    expect(() =>
      sourceSearchInputSchema.parse({
        provider: 'github',
        query: 'a',
        sort: 'relevance',
        order: 'desc',
        page: 0,
        perPage: 100,
      }),
    ).toThrow()
  })

  it('allows opening only HTTPS GitHub URLs', () => {
    const credentialedUrl = ['https://user:secret', 'github.com/fixture/component'].join('@')
    expect(sourceOpenUrlInputSchema.parse({ url: 'https://github.com/fixture/component' })).toEqual(
      { url: 'https://github.com/fixture/component' },
    )
    expect(() => sourceOpenUrlInputSchema.parse({ url: 'https://example.com/fixture' })).toThrow()
    expect(() => sourceOpenUrlInputSchema.parse({ url: 'file:///tmp/component' })).toThrow()
    expect(() =>
      sourceOpenUrlInputSchema.parse({
        url: `${credentialedUrl}?token=value`,
      }),
    ).toThrow()
    expect(() =>
      sourceLocatorInputSchema.parse({
        provider: 'github',
        locator: credentialedUrl,
      }),
    ).toThrow()
  })
})
