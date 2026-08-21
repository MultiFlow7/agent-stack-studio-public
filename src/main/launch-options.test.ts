import { describe, expect, it } from 'vitest'
import { parseLaunchOptions } from './launch-options'

describe('application launch options', () => {
  it('keeps the normal launch independent from a Studio Project', () => {
    expect(parseLaunchOptions(['/Applications/Agent Stack Studio'])).toEqual({ projectPath: null })
  })

  it('resolves a single Studio Project path without interpreting other Electron flags', () => {
    expect(
      parseLaunchOptions(
        [
          '/Applications/Agent Stack Studio',
          '--remote-debugging-port=9222',
          '--project',
          'fixture',
        ],
        '/tmp/e2e',
      ),
    ).toEqual({ projectPath: '/tmp/e2e/fixture' })
  })

  it.each([
    { argv: ['/Applications/Agent Stack Studio', '--project'] },
    { argv: ['/Applications/Agent Stack Studio', '--project', '--other'] },
    {
      argv: ['/Applications/Agent Stack Studio', '--project', 'first', '--project', 'second'],
    },
  ])('rejects an ambiguous project launch: $argv', ({ argv }) => {
    expect(() => parseLaunchOptions(argv)).toThrow(/--project/)
  })
})
