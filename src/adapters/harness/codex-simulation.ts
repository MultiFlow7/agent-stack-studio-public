export interface CodexSimulationConfig {
  endpoint: string
  providerId: 'studio-codex-simulation'
  modelId: 'codex-simulation'
  apiKey: 'studio-local-simulation'
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function codexSimulationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): CodexSimulationConfig | null {
  if (environment.STUDIO_CODEX_SIMULATION !== '1') return null
  const rawEndpoint = environment.STUDIO_CODEX_SIMULATION_URL
  if (!rawEndpoint) {
    throw new Error('Codex simulation 已启用，但缺少 STUDIO_CODEX_SIMULATION_URL。')
  }
  let endpoint: URL
  try {
    endpoint = new URL(rawEndpoint)
  } catch {
    throw new Error('STUDIO_CODEX_SIMULATION_URL 不是有效 URL。')
  }
  if (
    endpoint.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(endpoint.hostname) ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !['/v1', '/v1/'].includes(endpoint.pathname)
  ) {
    throw new Error('Codex simulation 只接受带明确端口的 loopback HTTP /v1 endpoint。')
  }
  return {
    endpoint: endpoint.toString().replace(/\/$/, ''),
    providerId: 'studio-codex-simulation',
    modelId: 'codex-simulation',
    apiKey: 'studio-local-simulation',
  }
}
