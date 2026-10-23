import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, readdir, access, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../tools/build.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'brp-public-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(repository, 'B.R.P Website'), join(root, 'B.R.P Website'), { recursive: true });
  return root;
}
async function filesAt(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesAt(root, path)); else result.push(path);
  }
  return result;
}

test('public build preserves existing routes, generates root index, and excludes unlisted files even inside asset directories', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'stale-secret.env'), 'never publish');
  await writeFile(join(root, 'B.R.P Website', 'assets', 'secret.env'), 'never publish');
  await writeFile(join(root, 'B.R.P Website', 'control', 'private-key.txt'), 'never publish');
  await buildSite({ root });
  const files = await filesAt(join(root, 'dist'));
  for (const needed of ['index.html', 'home.html', 'signup/index.html', 'checkin/index.html', 'data/index.html', 'control/index.html']) assert.ok(files.includes(needed), needed);
  assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), await readFile(join(root, 'dist/home.html'), 'utf8'));
  assert.equal(files.some(path => /meta\.env|secret|private-key|\.idea|cloudflare|\.toml/.test(path)), false);
  for (const route of ['signup/main.js', 'checkin/checkin.js', 'data/index.html']) assert.equal(await readFile(join(root, 'dist', route), 'utf8'), await readFile(join(root, 'B.R.P Website', route), 'utf8'));
});

test('every generated local HTML asset, navigation destination, and module import resolves', async t => {
  const root = await fixture(t);
  await buildSite({ root });
  const dist = join(root, 'dist');
  for (const file of await filesAt(dist)) {
    if (!/\.(?:html|js|mjs|css)$/.test(file)) continue;
    const text = await readFile(join(dist, file), 'utf8');
    const references = [...text.matchAll(/(?:src|href)=["']([^"']+)["']/g), ...text.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)];
    for (const match of references) {
      const ref = match[1];
      if (/^(?:[a-z]+:|#|\/\/)/i.test(ref)) continue;
      const target = ref.startsWith('/') ? join(dist, decodeURIComponent(ref)) : fileURLToPath(new URL(ref, new URL(file, `file:///${dist.replaceAll('\\', '/')}/`)));
      const full = ref.endsWith('/') ? join(target, 'index.html') : target;
      await assert.doesNotReject(access(resolve(full)), `${file} → ${ref}`);
    }
  }
});

test('build injects only the validated public endpoint and fails on unsafe API configuration', async t => {
  const root = await fixture(t);
  await buildSite({ root, apiBase: 'https://control.example.com/' });
  assert.match(await readFile(join(root, 'dist/control/config.mjs'), 'utf8'), /https:\/\/control\.example\.com/);
  await assert.rejects(buildSite({ root, apiBase: 'https://user:secret@example.com' }));
  await assert.rejects(buildSite({ root, apiBase: 'http://localhost:8888' }));
});
