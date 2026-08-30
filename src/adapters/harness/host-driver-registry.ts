import type { HarnessId } from '../../shared/native-agent'
import type { HarnessHostDriver } from './host-driver'
import { codexSimulationFromEnvironment } from './codex-simulation'
import { OpenClawHostDriver } from './openclaw-host-driver'
import { PiHostDriver } from './pi-host-driver'
import { CodexHostDriver } from './codex-host-driver'

export class HostDriverRegistry {
  readonly #drivers: Map<HarnessId, HarnessHostDriver>

  constructor(drivers?: HarnessHostDriver[], environment: NodeJS.ProcessEnv = process.env) {
    const simulation = codexSimulationFromEnvironment(environment)
    const configuredDrivers = drivers ?? [
      new PiHostDriver({ simulation }),
      new OpenClawHostDriver({ simulation }),
      new CodexHostDriver(),
    ]
    this.#drivers = new Map(configuredDrivers.map((driver) => [driver.id, driver]))
  }

  get(id: HarnessId): HarnessHostDriver {
    const driver = this.#drivers.get(id)
    if (!driver) throw new Error(`Harness Host Driver ${id} 未注册。`)
    return driver
  }

  probes() {
    return Promise.all([...this.#drivers.values()].map((driver) => driver.probe()))
  }
}
