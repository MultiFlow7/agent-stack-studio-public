import type { Rectangle } from 'electron'
import {
  applicationPreferencesSchema,
  defaultApplicationPreferences,
  rendererPreferencesSchema,
  type ApplicationPreferences,
  type RendererPreferences,
} from '../../shared/preferences'
import type { ProjectIndexRepository } from '../persistence/project-index-repository'

const PREFERENCE_KEY = 'application-ui-v1'

export interface ScreenWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface ResolvedWindowPlacement {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export function resolveWindowPlacement(
  preferences: ApplicationPreferences,
  workAreas: ScreenWorkArea[],
): ResolvedWindowPlacement {
  const widest = workAreas.length
    ? Math.max(...workAreas.map(({ width }) => width))
    : preferences.window.width
  const tallest = workAreas.length
    ? Math.max(...workAreas.map(({ height }) => height))
    : preferences.window.height
  const width = Math.max(900, Math.min(preferences.window.width, widest))
  const height = Math.max(620, Math.min(preferences.window.height, tallest))
  const { x, y } = preferences.window
  if (x === null || y === null) return { width, height, maximized: preferences.window.maximized }

  const visible = workAreas.some((area) => {
    const overlapWidth = Math.max(0, Math.min(x + width, area.x + area.width) - Math.max(x, area.x))
    const overlapHeight = Math.max(
      0,
      Math.min(y + height, area.y + area.height) - Math.max(y, area.y),
    )
    return overlapWidth >= 100 && overlapHeight >= 100
  })
  return visible
    ? { x, y, width, height, maximized: preferences.window.maximized }
    : { width, height, maximized: preferences.window.maximized }
}

export class ApplicationPreferencesService {
  readonly #repository: ProjectIndexRepository
  #preferences: ApplicationPreferences

  constructor(repository: ProjectIndexRepository) {
    this.#repository = repository
    let stored: unknown = null
    try {
      stored = repository.preference(PREFERENCE_KEY)
    } catch {
      stored = null
    }
    const parsed = applicationPreferencesSchema.safeParse(stored)
    this.#preferences = parsed.success
      ? parsed.data
      : structuredClone(defaultApplicationPreferences)
  }

  current(): ApplicationPreferences {
    return structuredClone(this.#preferences)
  }

  renderer(): RendererPreferences {
    return structuredClone(this.#preferences.renderer)
  }

  updateRenderer(input: RendererPreferences): RendererPreferences {
    this.#preferences = {
      ...this.#preferences,
      renderer: rendererPreferencesSchema.parse(input),
    }
    this.#persist()
    return this.renderer()
  }

  updateWindow(bounds: Rectangle, maximized: boolean): void {
    this.#preferences = applicationPreferencesSchema.parse({
      ...this.#preferences,
      window: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized,
      },
    })
    this.#persist()
  }

  #persist(): void {
    this.#repository.setPreference(PREFERENCE_KEY, this.#preferences)
  }
}
