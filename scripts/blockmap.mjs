// BLOCK:BLOCKMAP — scan src for data-block="..." and record file + line ranges.
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const files = walk('src').filter((f) => /\.(astro|ts|js|html)$/.test(f));
const map = {};
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const re = /data-block="([^"]+)"/g;
    let m;
    while ((m = re.exec(l))) {
      const id = m[1];
      if (!map[id]) map[id] = { file: f.replace(/^src\//, ''), start: i + 1, end: i + 1 };
      else map[id].end = i + 1;
    }
  });
}
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/blockmap.json', JSON.stringify(map, null, 2));
console.log('[blockmap] entries:', Object.keys(map).length);
