import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { loadStudioRuntime, studioBuildSignature } from './browser-session.mjs';
import { createStudioProject } from './studio-render.mjs';

export async function startStudioServer(projectDirectory) {
  const runtime = await loadStudioRuntime();
  const signature = await studioBuildSignature();
  const native = createStudioProject(runtime, projectDirectory);
  let served;
  try {
    served = await runtime.findPortAndServe(async request => {
      const response = await native.app.fetch(request);
      if (new URL(request.url).pathname === '/__hyperframes_config')
        return Response.json({ ...await response.json(), serverBuildSignature: signature });
      return response;
    }, 3002, projectDirectory, false, signature);
  } catch (error) {
    native.watcher.close(); await native.shutdown(); throw error;
  }
  const stop = async () => {
    native.watcher.close();
    await native.shutdown();
    if (served.type === 'started') {
      served.server.closeAllConnections();
      await new Promise(resolve => served.server.close(resolve));
    }
  };
  return { port: served.port, stop };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--launch') {
  // Exit this launcher before returning: the persistent server must not remain
  // a child of a CLI that may run another supervised task next.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(3)], {
    detached: true, stdio: ['ignore', 1, 2, 'ipc']
  });
  const stop = () => { child.kill('SIGTERM'); process.exit(1); };
  for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP', 'disconnect']) process.once(event, stop);
  try {
    const [ready] = await Promise.race([once(child, 'message'), once(child, 'exit').then(([code]) => {
      throw new Error(`Studio启动失败 (${code})`);
    })]);
    if (ready.error) throw new Error(ready.error);
    const detached = once(child, 'message');
    child.send('detach');
    await detached;
    child.disconnect(); child.unref();
    process.send(ready, error => { if (error) child.kill('SIGTERM'); process.exit(error ? 1 : 0); });
  } catch (error) {
    child.kill('SIGTERM');
    if (process.connected) process.send({ error: error.message }, () => process.exit(1));
    else process.exit(1);
  }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let server;
  try {
    const directory = path.resolve(process.argv[2]);
    server = await startStudioServer(directory);
    let stopping = false, detached = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.stop().finally(() => process.exit(0));
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
    process.once('message', message => {
      if (message === 'detach') { detached = true; process.send({ detached: true }); }
    });
    process.once('disconnect', () => { if (!detached) stop(); });
    process.send({ port: server.port }, () => {});
  } catch (error) {
    if (process.connected) process.send({ error: error.message }, () => process.exit(1));
    else { console.error(error); process.exit(1); }
  }
}
