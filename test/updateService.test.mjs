import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../electron/updateService.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'node20' });
const { checkForUpdates, parseVersion } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra });
const respond = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('compares numeric versions and normalizes prefixes and build metadata', async () => {
  assert.deepEqual(parseVersion(' V1.2.3+build.42 '), [1, 2, 3, 0]);
  for (const [current, latest, expected] of [
    ['1.9.0', 'v1.10.0', true],
    ['1.2.3', 'v1.2.3.0', false],
    ['1.2.3', 'v1.2.3+build.42', false],
    ['2.0.0', 'v1.99.99', false],
    ['1.2.3', 'v1.2.3.1', true]
  ]) {
    const result = await checkForUpdates(current, respond(release(latest)));
    assert.equal(result.isUpdateAvailable, expected, `${current} -> ${latest}`);
    assert.equal(result.releaseUrl, `https://github.com/suboy1219/droid-studio-lite/releases/tag/${encodeURIComponent(latest)}`);
  }
});

test('uses the project endpoint, GitHub headers and a timeout signal', async () => {
  await checkForUpdates('0.1.0', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/suboy1219/droid-studio-lite/releases/latest');
    assert.equal(options.headers['User-Agent'], 'DroidStudioLite/0.1.0');
    assert.equal(options.headers.Accept, 'application/vnd.github+json');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(release('v0.1.0')));
  });
});

test('treats 404, drafts and prereleases as no stable release', async () => {
  assert.equal(await checkForUpdates('0.1.0', respond({}, 404)), null);
  assert.equal(await checkForUpdates('0.1.0', respond(release('v9.0.0', { draft: true }))), null);
  assert.equal(await checkForUpdates('0.1.0', respond(release('v9.0.0-beta.1', { prerelease: true }))), null);
});

test('reports rate limits, server errors and malformed responses', async () => {
  for (const status of [403, 429, 500]) {
    await assert.rejects(checkForUpdates('0.1.0', respond({}, status)), /GitHub HTTP/);
  }
  for (const body of [null, {}, release('banana'), release('v1.2.3-beta.1')]) {
    await assert.rejects(checkForUpdates('0.1.0', respond(body)));
  }
  await assert.rejects(checkForUpdates('0.1.0', async () => new Response('not json')));
});

test('propagates connection failures and timeouts to the menu error handler', async () => {
  for (const error of [new TypeError('network unavailable'), new DOMException('timeout', 'TimeoutError')]) {
    await assert.rejects(checkForUpdates('0.1.0', async () => { throw error; }), (actual) => actual === error);
  }
});
