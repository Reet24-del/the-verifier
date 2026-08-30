import http from 'node:http';

const port = Number.parseInt(process.env.GROQ_PROXY_PORT ?? '8791', 10);
const upstreamBaseUrl = process.env.GROQ_UPSTREAM_BASE_URL ?? 'https://api.groq.com';
const minimumStartIntervalMs = Number.parseInt(process.env.GROQ_MINIMUM_START_INTERVAL_MS ?? '65000', 10);
let queue = Promise.resolve();
let lastStartAt = 0;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const server = http.createServer((request, response) => {
  const run = async () => {
    const remaining = Math.max(0, lastStartAt + minimumStartIntervalMs - Date.now());
    if (remaining > 0) await wait(remaining);
    lastStartAt = Date.now();

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const target = new URL(request.url ?? '/', upstreamBaseUrl);
    const headers = { ...request.headers };
    delete headers.host;
    delete headers['content-length'];

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : body,
    });
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    response.end(Buffer.from(await upstream.arrayBuffer()));
  };

  const pending = queue.then(run, run);
  queue = pending.catch(() => {});
  pending.catch((error) => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Proxy failure' } }));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Groq rate-limit proxy listening on ${port}`);
});
