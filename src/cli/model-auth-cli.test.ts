import { describe, expect, it, vi } from 'vitest'
import { buildAgentModelReadiness, harnessModelCapability } from '../shared/model-auth'
import type { ModelAuthSelectInput, ModelAuthView } from '../shared/model-auth-ipc'
import { executeCliCommand, parseArguments } from './studio'

function view(): ModelAuthView {
  const selection = {
    providerId: 'openai',
    modelId: 'gpt-5.1',
    credentialRequirement: { method: 'api-key' as const, credentialKind: 'api-key' as const },
  }
  return {
    harness: { id: 'pi', label: 'Pi' },
    capability: harnessModelCapability('pi'),
    probe: {
      id: 'pi',
      label: 'Pi',
      executable: '/trusted/pi',
      status: 'ready',
      version: '0.84.2',
      requiredVersion: '0.84.2',
      capabilities: {
        prompt: 'native',
        skills: 'native',
        memory: 'adapted',
        mcp: 'unavailable',
        sessions: 'native',
      },
      detail: '已就绪。',
    },
    selection,
    readiness: buildAgentModelReadiness({
      stackCompatible: true,
      harnessStatus: 'ready',
      configurationState: 'configured',
      configuration: selection,
      authentication: null,
      verification: {
        state: 'not-run',
        configurationHash: null,
        checkedAt: null,
        failure: null,
      },
    }),
  }
}

describe('agent model CLI', () => {
  it('accepts an API Key only from stdin and never returns it in JSON data', async () => {
    const canary = 'opaque-cli-provider-canary-12f47'
    const select = vi
      .fn<(input: ModelAuthSelectInput) => Promise<ModelAuthView>>()
      .mockResolvedValue(view())
    const configureApiKey = vi.fn().mockResolvedValue(view())
    const result = await executeCliCommand(
      parseArguments([
        'agent',
        'model',
        'configure',
        '--provider',
        'openai',
        '--model',
        'gpt-5.1',
        '--auth-method',
        'api-key',
        '--revision',
        '2',
        '--stdin',
        '--json',
      ]),
      {
        modelAuth: {
          view: vi.fn(),
          select,
          configureApiKey,
          launchOfficialLogin: vi.fn(),
          refreshAuthentication: vi.fn(),
          verify: vi.fn(),
        },
        readSecretInput: () => Promise.resolve(canary),
      },
    )

    expect(select).toHaveBeenCalledOnce()
    expect(select.mock.calls[0]?.[0]).toEqual({
      expectedRevision: 2,
      modelConfiguration: {
        providerId: 'openai',
        modelId: 'gpt-5.1',
        credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
      },
    })
    expect(configureApiKey).toHaveBeenCalledWith(canary)
    expect(JSON.stringify(result)).not.toContain(canary)
  })

  it('rejects credential argv and refuses verification without explicit cost confirmation', async () => {
    const dependencies = {
      modelAuth: {
        view: vi.fn(),
        select: vi.fn(),
        configureApiKey: vi.fn(),
        launchOfficialLogin: vi.fn(),
        refreshAuthentication: vi.fn(),
        verify: vi.fn(),
      },
      readSecretInput: vi.fn(),
    }
    await expect(
      executeCliCommand(
        parseArguments([
          'agent',
          'model',
          'configure',
          '--provider',
          'openai',
          '--model',
          'gpt-5.1',
          '--auth-method',
          'api-key',
          '--revision',
          '2',
          '--api-key',
          'forbidden',
        ]),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' })
    expect(dependencies.readSecretInput).not.toHaveBeenCalled()

    await expect(
      executeCliCommand(parseArguments(['agent', 'model', 'verify', '--json']), dependencies),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' })
    expect(dependencies.modelAuth.verify).not.toHaveBeenCalled()
  })
})
