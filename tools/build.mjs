import { copyFile, mkdir, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateApiBase } from '../B.R.P Website/control/api.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
// Deliberately list individual public files: never copy entire source directories.
const publicFiles = [
  'home.html', 'homestyle.css',
  'assets/카카오_갈색.png', 'assets/카카오_노란색.png',
  'signup/index.html', 'signup/main.js', 'signup/style.css',
  'checkin/index.html', 'checkin/checkin.js', 'checkin/style.css',
  'data/index.html',
  'control/index.html', 'control/style.css', 'control/control.js',
  'control/state.mjs', 'control/api.mjs'
];

export async function buildSite({ root = repository, apiBase = '' } = {}) {
  const endpoint = apiBase ? validateApiBase(apiBase) : '';
  const resolvedRoot = await realpath(resolve(root));
  const source = await realpath(join(resolvedRoot, 'B.R.P Website'));
  const output = resolve(resolvedRoot, 'dist');
  if (dirname(output) !== resolvedRoot || output === resolvedRoot) throw new Error('Output must be the project dist directory.');
  for (const file of publicFiles) {
    const path = join(source, file);
    const resolved = await realpath(path);
    if (!resolved.startsWith(source + sep) || !(await lstat(path)).isFile()) throw new Error(`Public source must be a regular file within the site: ${file}`);
  }
  const existing = await lstat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Refusing to replace a non-directory or linked dist.');
  // The absolute, fixed output path was verified above; rebuild removes stale publish files.
  await rm(output, { recursive: true, force: true });
  for (const file of publicFiles) {
    await mkdir(dirname(join(output, file)), { recursive: true });
    await copyFile(join(source, file), join(output, file));
  }
  await writeFile(join(output, 'index.html'), await readFile(join(source, 'home.html')));
  await writeFile(join(output, 'control/config.mjs'), `// Public endpoint only. No credentials belong in this file.\nexport const API_BASE_URL = ${JSON.stringify(endpoint)};\n`);
  return { output, fileCount: publicFiles.length + 2, configured: Boolean(endpoint) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await buildSite({ apiBase: process.env.CONTROL_API_BASE_URL || '' });
  console.log(`Built ${result.fileCount} public files in ${result.output}. Hosted control: ${result.configured ? 'endpoint configured' : 'unconfigured (sign-in disabled)'}.`);
}
