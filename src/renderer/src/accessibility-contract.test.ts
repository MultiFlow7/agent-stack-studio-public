import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function relativeLuminance(hex: string): number {
  const matches = hex.slice(1).match(/../g)
  if (!matches) throw new Error(`Invalid hexadecimal color: ${hex}`)
  const channels = matches
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

describe('renderer accessibility contract', () => {
  it.each([
    ['muted text on the main surface', '#687486', '#fbfcfd'],
    ['secondary text on the main surface', '#576477', '#fbfcfd'],
    ['primary button text', '#ffffff', '#3158a6'],
    ['destructive button text', '#ffffff', '#8d2929'],
    ['error feedback text', '#852828', '#fff2f2'],
    ['success feedback text', '#2f6534', '#eff8f0'],
    ['warning feedback text', '#745717', '#fff8e5'],
  ])('%s meets the WCAG AA body-text contrast floor', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps visible focus and reduced-motion fallbacks in the committed stylesheet', async () => {
    const styles = await readFile(path.resolve('src/renderer/src/styles.css'), 'utf8')
    expect(styles).toMatch(/outline:\s*3px solid var\(--focus\)/)
    expect(styles).toMatch(/\.sr-only\s*\{[^}]*clip-path:\s*inset\(50%\)/s)
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(styles).toMatch(/transition-duration:\s*0\.01ms !important/)
  })
})
