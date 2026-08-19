import fs from 'fs';
import { handleSearchTools } from './src/tools/search.js';

const tmpDir = '/tmp/lmst_ws_tools_smoke';
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(`${tmpDir}/alpha.txt`, 'hello world');
fs.writeFileSync(`${tmpDir}/beta.log`, 'some log');

const g = await handleSearchTools('glob_search', {
  query: '*',
  path: tmpDir,
  max_results: 20
}, { conversation_id: 'smoke-test' });
console.log('[glob_search] ok=', g.ok, 'matches=', JSON.stringify(g.fileMatches));

const l = await handleSearchTools('locate', {
  query: 'alpha',
  path: tmpDir,
  mode: 'files'
}, { conversation_id: 'smoke-test' });
console.log('[locate] ok=', l.ok, 'matches=', JSON.stringify(l.fileMatches));

const f = await handleSearchTools('file_search', {
  query: 'hello',
  path: tmpDir,
  regex: false
}, { conversation_id: 'smoke-test' });
console.log('[file_search] ok=', f.ok, 'matches=', JSON.stringify(f.contentMatches));

try {
  await handleSearchTools('glob_search', { query: '*', path: '/tmp/definitely_missing_dir_xyz' }, { conversation_id: 'smoke-test' });
  console.log('[missing-dir] UNEXPECTED: no throw');
} catch (e) {
  console.log('[missing-dir] threw as expected:', e.message);
}

fs.rmSync(tmpDir, { recursive: true, force: true });
