import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodexSimulationServer } from './codex-openai-simulation.mjs'

let simulation

afterEach(async () => {
  await simulation?.close()
  simulation = undefined
})

describe('Codex OpenAI simulation proxy', () => {
  it('exposes authenticated non-streaming and streaming completions without logging prompts', async () => {
    const runModel = vi.fn(async ({ prompt }) => ({
      text: prompt.includes('M33 marker') ? 'SIMULATION_OK' : 'unexpected',
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }))
    simulation = await createCodexSimulationServer({ runModel })
    const details = await simulation.listen()
    const request = {
      model: details.model,
      messages: [{ role: 'user', content: 'M33 marker' }],
    }
    const response = await fetch(`${details.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${details.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      model: 'codex-simulation',
      choices: [{ message: { content: 'SIMULATION_OK' } }],
      usage: { total_tokens: 5 },
    })
    expect(runModel).toHaveBeenCalledOnce()

    const streamed = await fetch(`${details.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${details.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...request, stream: true }),
    })
    expect(streamed.status).toBe(200)
    const streamBody = await streamed.text()
    expect(streamBody).toContain('SIMULATION_OK')
    expect(streamBody).toContain('data: [DONE]')
  })

  it('rejects unauthenticated and invalid-model requests', async () => {
    simulation = await createCodexSimulationServer({
      runModel: vi.fn(async () => {
        throw new Error('should not run')
      }),
    })
    const details = await simulation.listen()
    const unauthorized = await fetch(`${details.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: details.model, messages: [{ role: 'user', content: 'x' }] }),
    })
    expect(unauthorized.status).toBe(401)

    const wrongModel = await fetch(`${details.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${details.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'other', messages: [{ role: 'user', content: 'x' }] }),
    })
    expect(wrongModel.status).toBe(400)
  })
})
