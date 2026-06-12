import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { FrameDecoder, LspClient, encodeMessage } from '../src/services/lsp/index.js';
import type { LspDiagnostic } from '../src/services/lsp/index.js';

type Msg = Record<string, unknown>;
type Responder = (msg: Msg, send: (reply: object) => void) => void;

interface Harness {
  client: LspClient;
  /** Every frame the client wrote (requests, notifications, responses). */
  received: Msg[];
  /** Push a frame from the fake server to the client. */
  send: (msg: object) => void;
}

/** Fake LSP server: two PassThrough streams plus an optional request responder. */
function createHarness(responder?: Responder): Harness {
  const toServer = new PassThrough(); // client -> server (server stdin)
  const fromServer = new PassThrough(); // server -> client (server stdout)
  const decoder = new FrameDecoder();
  const received: Msg[] = [];
  const send = (msg: object): void => {
    fromServer.write(encodeMessage(msg));
  };
  toServer.on('data', (chunk: Buffer) => {
    for (const msg of decoder.push(chunk)) {
      const m = msg as Msg;
      received.push(m);
      responder?.(m, send);
    }
  });
  const client = new LspClient({ input: toServer, output: fromServer, rootUri: 'file:///tmp/workspace' });
  return { client, received, send };
}

const answerInitialize: Responder = (m, send) => {
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', id: m.id as number, result: { capabilities: { hoverProvider: true } } });
  }
};

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const range = (line: number, character: number) => ({
  start: { line, character },
  end: { line, character: character + 1 },
});

describe('LspClient initialize', () => {
  test('sends initialize with capabilities, then the initialized notification', async () => {
    const { client, received } = createHarness(answerInitialize);
    await client.initialize();
    await waitFor(() => received.some((m) => m.method === 'initialized'));

    const init = received.find((m) => m.method === 'initialize');
    expect(init).toBeDefined();
    const params = init!.params as {
      rootUri: string;
      capabilities: { textDocument: Record<string, unknown> };
    };
    expect(params.rootUri).toBe('file:///tmp/workspace');
    expect(Object.keys(params.capabilities.textDocument)).toEqual(
      expect.arrayContaining(['synchronization', 'publishDiagnostics', 'hover', 'definition']),
    );
    expect(client.serverCapabilities).toEqual({ hoverProvider: true });

    const order = received.map((m) => m.method).filter((m) => m === 'initialize' || m === 'initialized');
    expect(order).toEqual(['initialize', 'initialized']);
  });
});

describe('LspClient diagnostics', () => {
  test('publishDiagnostics dispatches to onDiagnostics listeners', async () => {
    const { client, send } = createHarness();
    const got: Array<{ uri: string; diags: LspDiagnostic[] }> = [];
    client.onDiagnostics((uri, diags) => got.push({ uri, diags }));

    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///tmp/workspace/a.ts',
        diagnostics: [
          { range: range(4, 2), severity: 1, source: 'ts', message: 'boom' },
          { range: range(9, 0), severity: 2, message: 'meh' },
        ],
      },
    });

    await waitFor(() => got.length === 1);
    expect(got[0].uri).toBe('file:///tmp/workspace/a.ts');
    expect(got[0].diags).toHaveLength(2);
    expect(got[0].diags[0].message).toBe('boom');
    expect(got[0].diags[1].severity).toBe(2);
  });
});

describe('LspClient hover normalization', () => {
  function hoverHarness(contents: unknown): Harness {
    return createHarness((m, send) => {
      if (m.method === 'textDocument/hover') {
        send({ jsonrpc: '2.0', id: m.id as number, result: contents === undefined ? null : { contents } });
      }
    });
  }

  test('MarkupContent', async () => {
    const { client } = hoverHarness({ kind: 'markdown', value: '**Signature**\n\n`x: number`' });
    await expect(client.hover('file:///tmp/a.ts', 0, 1)).resolves.toBe('**Signature**\n\n`x: number`');
  });

  test('MarkedString object and plain string', async () => {
    const objHarness = hoverHarness({ language: 'typescript', value: 'const x: number' });
    await expect(objHarness.client.hover('file:///tmp/a.ts', 0, 1)).resolves.toBe('const x: number');

    const strHarness = hoverHarness('plain words');
    await expect(strHarness.client.hover('file:///tmp/a.ts', 0, 1)).resolves.toBe('plain words');
  });

  test('MarkedString[] picks the first meaningful entry', async () => {
    const { client } = hoverHarness(['', '   ', { language: 'ts', value: 'second entry' }]);
    await expect(client.hover('file:///tmp/a.ts', 0, 1)).resolves.toBe('second entry');
  });

  test('null hover result resolves to null', async () => {
    const { client } = hoverHarness(undefined); // responder sends result: null
    await expect(client.hover('file:///tmp/a.ts', 0, 1)).resolves.toBeNull();
  });
});

describe('LspClient definition normalization', () => {
  function definitionHarness(result: unknown): Harness {
    return createHarness((m, send) => {
      if (m.method === 'textDocument/definition') {
        send({ jsonrpc: '2.0', id: m.id as number, result });
      }
    });
  }

  test('single Location', async () => {
    const { client } = definitionHarness({ uri: 'file:///tmp/b.ts', range: range(3, 4) });
    await expect(client.definition('file:///tmp/a.ts', 0, 0)).resolves.toEqual({
      uri: 'file:///tmp/b.ts',
      line: 3,
      character: 4,
    });
  });

  test('Location[] takes the first', async () => {
    const { client } = definitionHarness([
      { uri: 'file:///tmp/c.ts', range: range(5, 6) },
      { uri: 'file:///tmp/d.ts', range: range(7, 8) },
    ]);
    await expect(client.definition('file:///tmp/a.ts', 0, 0)).resolves.toEqual({
      uri: 'file:///tmp/c.ts',
      line: 5,
      character: 6,
    });
  });

  test('LocationLink[] uses targetSelectionRange of the first link', async () => {
    const { client } = definitionHarness([
      {
        targetUri: 'file:///tmp/e.ts',
        targetRange: range(9, 0),
        targetSelectionRange: range(9, 2),
      },
    ]);
    await expect(client.definition('file:///tmp/a.ts', 0, 0)).resolves.toEqual({
      uri: 'file:///tmp/e.ts',
      line: 9,
      character: 2,
    });
  });

  test('empty array and null both normalize to null', async () => {
    await expect(definitionHarness([]).client.definition('file:///tmp/a.ts', 0, 0)).resolves.toBeNull();
    await expect(definitionHarness(null).client.definition('file:///tmp/a.ts', 0, 0)).resolves.toBeNull();
  });
});

describe('LspClient request lifecycle', () => {
  test('request times out when the server never answers', async () => {
    const { client } = createHarness(); // no responder
    await expect(client.request('custom/never', {}, 40)).rejects.toThrow(/timed out/);
  });

  test('request rejects on a server error response', async () => {
    const { client } = createHarness((m, send) => {
      if (m.method === 'custom/err') {
        send({ jsonrpc: '2.0', id: m.id as number, error: { code: -32601, message: 'nope' } });
      }
    });
    await expect(client.request('custom/err', {}, 500)).rejects.toThrow(/nope/);
  });
});

describe('LspClient document lifecycle (full sync)', () => {
  test('didOpen starts at version 1 and didChange increments per uri', async () => {
    const { client, received } = createHarness();
    client.didOpen('file:///tmp/v.ts', 'typescript', 'a');
    client.didChange('file:///tmp/v.ts', 'ab');
    client.didChange('file:///tmp/v.ts', 'abc');
    client.didOpen('file:///tmp/other.ts', 'typescript', 'x');
    client.didChange('file:///tmp/other.ts', 'xy');
    client.didSave('file:///tmp/v.ts', 'abc');
    client.didClose('file:///tmp/v.ts');

    await waitFor(() => received.length >= 7);
    const version = (m: Msg): number =>
      ((m.params as Msg).textDocument as { version: number }).version;
    const forUri = (uri: string, method: string): Msg[] =>
      received.filter(
        (m) => m.method === method && ((m.params as Msg).textDocument as { uri: string }).uri === uri,
      );

    expect(version(forUri('file:///tmp/v.ts', 'textDocument/didOpen')[0])).toBe(1);
    expect(forUri('file:///tmp/v.ts', 'textDocument/didChange').map(version)).toEqual([2, 3]);
    expect(forUri('file:///tmp/other.ts', 'textDocument/didChange').map(version)).toEqual([2]);

    const change = forUri('file:///tmp/v.ts', 'textDocument/didChange')[1];
    expect((change.params as Msg).contentChanges).toEqual([{ text: 'abc' }]); // full sync
    expect(forUri('file:///tmp/v.ts', 'textDocument/didSave')).toHaveLength(1);
    expect(forUri('file:///tmp/v.ts', 'textDocument/didClose')).toHaveLength(1);
  });
});

describe('LspClient server-to-client requests', () => {
  test('workspace/configuration is answered with one null per item', async () => {
    const { received, send } = createHarness();
    send({ jsonrpc: '2.0', id: 99, method: 'workspace/configuration', params: { items: [{}, {}] } });
    await waitFor(() => received.some((m) => m.id === 99 && m.method === undefined));
    const reply = received.find((m) => m.id === 99 && m.method === undefined)!;
    expect(reply.result).toEqual([null, null]);
  });

  test('client/registerCapability and workDoneProgress/create get null acks', async () => {
    const { received, send } = createHarness();
    send({ jsonrpc: '2.0', id: 7, method: 'client/registerCapability', params: { registrations: [] } });
    send({ jsonrpc: '2.0', id: 8, method: 'window/workDoneProgress/create', params: { token: 't' } });
    await waitFor(() => received.filter((m) => m.method === undefined && m.id !== undefined).length === 2);
    const ids = received.filter((m) => m.method === undefined).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([7, 8]));
    for (const reply of received.filter((m) => m.method === undefined)) {
      expect(reply.result).toBeNull();
    }
  });

  test('unknown server notifications are ignored without breaking the client', async () => {
    const { client, send } = createHarness((m, sendReply) => {
      if (m.method === 'custom/echo') sendReply({ jsonrpc: '2.0', id: m.id as number, result: 'ok' });
    });
    send({ jsonrpc: '2.0', method: 'window/logMessage', params: { type: 3, message: 'hi' } });
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 't', value: {} } });
    await expect(client.request('custom/echo', {}, 500)).resolves.toBe('ok');
  });
});

describe('LspClient dispose', () => {
  test('sends shutdown then exit, and rejects later requests', async () => {
    const { client, received } = createHarness((m, send) => {
      if (m.method === 'shutdown') send({ jsonrpc: '2.0', id: m.id as number, result: null });
    });
    await client.dispose();
    await waitFor(() => received.some((m) => m.method === 'exit'));
    const methods = received.map((m) => m.method).filter((m) => m === 'shutdown' || m === 'exit');
    expect(methods).toEqual(['shutdown', 'exit']);
    await expect(client.request('anything', {})).rejects.toThrow(/disposed/);
    await expect(client.dispose()).resolves.toBeUndefined(); // idempotent, never throws
  });
});
