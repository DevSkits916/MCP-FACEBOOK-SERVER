export interface SSESession {
  send(event: string, data: unknown): void;
  comment(text: string): void;
  close(): void;
}

export function createSSESession(onClose?: () => void): { session: SSESession; stream: ReadableStream<Uint8Array> } {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
    cancel() {
      if (!closed) {
        closed = true;
        onClose?.();
      }
    },
  });

  const send = (event: string, data: unknown) => {
    if (closed) return;
    let payload = '';
    if (event) {
      payload += `event: ${event}\n`;
    }
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    for (const line of text.split(/\n/)) {
      payload += `data: ${line}\n`;
    }
    payload += '\n';
    controller.enqueue(encoder.encode(payload));
  };

  const comment = (text: string) => {
    if (closed) return;
    controller.enqueue(encoder.encode(`: ${text}\n\n`));
  };

  const close = () => {
    if (closed) return;
    closed = true;
    onClose?.();
    controller.close();
  };

  return {
    stream,
    session: {
      send,
      comment,
      close,
    },
  };
}

export function sseResponse(
  handler: (session: SSESession) => void | (() => void) | Promise<void | (() => void)>,
  onClose?: () => void
): Response {
  let cleanup: (() => void) | undefined;
  const { session, stream } = createSSESession(() => {
    try {
      cleanup?.();
    } finally {
      onClose?.();
    }
  });
  queueMicrotask(async () => {
    try {
      const result = await handler(session);
      if (typeof result === 'function') {
        cleanup = result;
      }
    } catch (error) {
      console.error('SSE handler error', error);
      session.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
