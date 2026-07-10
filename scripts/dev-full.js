import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env: { ...process.env, HOST: process.env.API_HOST || '0.0.0.0', PORT: process.env.PORT || '8787' } }),
  spawn(process.platform === 'win32' ? 'npm run dev' : 'npm', process.platform === 'win32' ? [] : ['run', 'dev'], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' })
];

function shutdown(signal) {
  for (const child of children) child.kill(signal);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal);
    process.exit(0);
  });
}

Promise.race(children.map((child) => new Promise((resolve) => child.on('exit', resolve)))).then((code) => {
  shutdown('SIGTERM');
  process.exit(typeof code === 'number' ? code : 0);
});
