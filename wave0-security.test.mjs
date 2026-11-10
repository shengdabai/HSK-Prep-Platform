import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
// Reuse ESLint's locked YAML parser without adding a dependency or assuming pnpm's store layout.
const webRequire = createRequire(new URL('apps/web/package.json', import.meta.url));
const eslintRequire = createRequire(webRequire.resolve('eslint/package.json'));
const { load } = eslintRequire('js-yaml');

function assertWorkflowSecurity(source, name = 'fixture') {
  const workflow = load(source);
  assert.ok(workflow && typeof workflow === 'object' && !Array.isArray(workflow), name);
  const triggers = workflow.on;
  const events = typeof triggers === 'string' ? [triggers]
    : Array.isArray(triggers) ? triggers : Object.keys(triggers ?? {});
  assert.ok(!events.includes('pull_request_target'), `${name}: pull_request_target is forbidden`);

  const seen = new WeakSet();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uses') {
        assert.equal(typeof child, 'string', `${name}: uses must be a string`);
        const action = child.trim();
        if (!action.startsWith('./')) {
          assert.match(action, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `${name}: ${action}`);
        }
      }
      visit(child);
    }
  }
  visit(workflow);
}

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
    assertWorkflowSecurity(source, name);
  }
});

test('workflow guard rejects unsafe YAML variants', async (t) => {
  const fixtures = {
    'scalar trigger': 'on: pull_request_target',
    'flow sequence trigger': 'on: [pull_request_target]',
    'mixed flow sequence trigger': 'on: [push, pull_request_target]',
    'block sequence trigger': 'on:\n  - pull_request_target',
    'block mapping trigger': 'on:\n  pull_request_target:',
    'quoted mapping trigger': '"on": {"pull_request_target": {}}',
    'aliased trigger': 'env: {event: &event pull_request_target}\non: [*event]',
    'escaped trigger': 'on: ["pull_request_\\u0074arget"]',
    'plain block uses': 'jobs:\n  ci:\n    steps:\n      - uses: actions/checkout@v4',
    'single-quoted uses': "jobs:\n  ci:\n    steps:\n      - 'uses': 'actions/checkout@v4'",
    'double-quoted uses': 'jobs: {ci: {steps: [{"uses": "actions/checkout@v4"}]}}',
    'plain flow uses': 'jobs: {ci: {steps: [{uses: actions/checkout@v4}]}}',
    'folded uses': 'jobs:\n  ci:\n    steps:\n      - uses: >-\n          actions/checkout@v4',
    'aliased uses': 'env: {action: &action actions/checkout@v4}\njobs: {ci: {steps: [{uses: *action}]}}',
    'merged uses': 'env: &step {uses: actions/checkout@v4}\njobs: {ci: {steps: [{<<: *step}]}}',
    'unsafe action after a pinned action': `jobs: {ci: {steps: [{uses: 'actions/checkout@${'a'.repeat(40)}'}, {'uses': 'actions/setup-node@v4'}]}}`,
    'reusable workflow uses': "jobs: {ci: {'uses': 'owner/repo/.github/workflows/test.yml@main'}}",
    'non-string uses': 'jobs: {ci: {steps: [{uses: null}]}}',
    'malformed YAML': 'on: [push',
    'duplicate keys': 'on: push\non: pull_request_target',
  };
  for (const [name, source] of Object.entries(fixtures)) {
    await t.test(name, () => assert.throws(() => assertWorkflowSecurity(source)));
  }
});

test('workflow guard accepts safe YAML variants', async (t) => {
  const sha = 'a'.repeat(40);
  const fixtures = {
    'scalar trigger': 'on: push',
    'flow sequence trigger': 'on: [push, pull_request]',
    'block sequence trigger': 'on:\n  - push\n  - pull_request',
    'mapping trigger': '"on": {push: {}, pull_request: {}}',
    'quoted pinned uses': `jobs: {ci: {steps: [{'uses': 'actions/checkout@${sha}'}]}}`,
    'local action and reusable workflow': `jobs:\n  ci:\n    steps:\n      - uses: ./local/action\n  reusable:\n    uses: owner/repo/.github/workflows/test.yml@${sha}`,
    'merged pinned uses': `env: &step {uses: actions/checkout@${sha}}\njobs: {ci: {steps: [{<<: *step}]}}`,
    'script text is not workflow structure': 'jobs:\n  ci:\n    steps:\n      - run: |\n          pull_request_target:\n          uses: actions/checkout@v4',
    'comments are not workflow structure': '# on: pull_request_target\n# uses: actions/checkout@v4\non: push',
  };
  for (const [name, source] of Object.entries(fixtures)) {
    await t.test(name, () => assert.doesNotThrow(() => assertWorkflowSecurity(source)));
  }
});
