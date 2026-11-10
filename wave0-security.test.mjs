import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('production repository cannot fall back to in-memory data', async () => {
  const source = await read('packages/db/src/repository.ts');
  assert.match(source, /process\.env\.NODE_ENV === "production"/);
  assert.match(source, /process\.env\.VERCEL_ENV === "production"/);
  assert.match(source, /mock repository is disabled/);
  assert.ok(source.indexOf('throw new Error') < source.lastIndexOf('return mockRepository'));
});

test('persistent repository requires its service-role credential', async () => {
  const source = await read('packages/db/src/supabase.ts');
  assert.match(source, /repositoryConfigured: Boolean\(url && serviceRoleKey\)/);
});

test('GitHub workflows pin external actions and avoid privileged pull request triggers', async () => {
  const directory = new URL('.github/workflows/', import.meta.url);
  const workflows = (await readdir(directory)).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(workflows.length > 0);
  for (const name of workflows) {
    const source = await readFile(new URL(name, directory), 'utf8');
    assert.doesNotMatch(source, /^\s*pull_request_target\s*:/m, name);
    for (const [, action] of source.matchAll(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)/gm)) {
      if (action.startsWith('./')) continue;
      assert.match(action, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `${name}: ${action}`);
    }
  }
});
