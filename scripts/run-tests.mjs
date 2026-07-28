#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tests = readdirSync(resolve('tests'))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => resolve('tests', name));
const child = spawn(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, ENABLE_DEMO_SEED: '1', ENABLE_LEGACY_TEST_BOOTSTRAP: '1', NODE_ENV: 'test' },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
