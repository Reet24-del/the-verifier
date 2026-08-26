import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(port, hasExited) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (hasExited()) throw new Error('Server process exited before becoming healthy');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError ?? new Error('Server did not become healthy');
}

test('server entrypoint listens on the configured PORT', async (t) => {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  let exited = false;
  child.once('exit', () => { exited = true; });
  t.after(() => {
    if (!exited) child.kill();
  });

  const response = await waitForHealth(port, () => exited);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
