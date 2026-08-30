import { describe, expect, it } from 'vitest'
import { agentProfileSchema, defaultAgentProfile } from './agent-profile'

describe('Agent Profile', () => {
  it('accepts minimal Prompt, Markdown Memory, Skill and reference-only MCP facts', () => {
    expect(
      agentProfileSchema.parse({
        ...defaultAgentProfile,
        instructions: 'Be concise.',
        memoryMarkdown: '# Memory',
        skills: [{ id: 'research', name: 'Research', markdown: '# Research', enabled: true }],
        mcpServers: [
          {
            id: 'docs',
            name: 'Docs',
            transport: 'http',
            command: null,
            args: [],
            url: 'https://mcp.example.test',
            secretReferences: ['DOCS_TOKEN'],
            enabled: true,
            approval: 'review-required',
          },
        ],
      }),
    ).toBeTruthy()
  })

  it('rejects duplicate IDs and transport ambiguity', () => {
    const server = {
      id: 'docs',
      name: 'Docs',
      transport: 'stdio' as const,
      command: null,
      args: [],
      url: 'https://mcp.example.test',
      secretReferences: [],
      enabled: true,
      approval: 'approved' as const,
    }
    expect(() =>
      agentProfileSchema.parse({
        ...defaultAgentProfile,
        skills: [
          { id: 'same', name: 'One', markdown: '', enabled: true },
          { id: 'same', name: 'Two', markdown: '', enabled: true },
        ],
        mcpServers: [server],
      }),
    ).toThrow()
  })

  it('rejects inline MCP secrets in URL queries and process arguments', () => {
    const base = {
      id: 'docs',
      name: 'Docs',
      secretReferences: [],
      enabled: true,
      approval: 'approved' as const,
    }
    expect(() =>
      agentProfileSchema.parse({
        ...defaultAgentProfile,
        mcpServers: [
          {
            ...base,
            transport: 'http',
            command: null,
            args: [],
            url: 'https://mcp.example.test/rpc?token=private',
          },
        ],
      }),
    ).toThrow('Keychain')
    expect(() =>
      agentProfileSchema.parse({
        ...defaultAgentProfile,
        mcpServers: [
          {
            ...base,
            transport: 'stdio',
            command: '/usr/bin/example',
            args: ['--api-key=private'],
            url: null,
          },
        ],
      }),
    ).toThrow('Keychain')
  })
})
