import readline from 'node:readline'

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const mode = process.argv[2] ?? 'normal'

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

lines.on('line', (line) => {
  if (mode === '--hang') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    if (mode === '--invalid-json') {
      process.stdout.write('{not-json}\n')
      return
    }
    if (mode === '--handshake-error') {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'fixture handshake failure' } })}\n`,
      )
      return
    }
    respond(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'studio-fixture', version: '1.0.0' },
    })
    return
  }
  if (message.method === 'tools/list') {
    respond(message.id, {
      tools: [
        {
          name: 'fixture_echo',
          description: 'Returns one inert test value.',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      ],
    })
    return
  }
  if (message.method === 'tools/call') {
    if (mode === '--tool-error') {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'fixture tool failure' } })}\n`,
      )
      return
    }
    if (message.params?.name !== 'fixture_echo') {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown tool' } })}\n`,
      )
      return
    }
    respond(message.id, {
      content: [
        { type: 'text', text: `fixture:${String(message.params?.arguments?.value ?? '')}` },
      ],
      isError: false,
    })
  }
})
