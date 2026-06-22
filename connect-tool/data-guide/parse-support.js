// Parse the 7 <platform>.support-matrix.ts files into clean capability states.
// Output: capability.json = { Platform: { product: { sourceKey: 'supported'|'empty_possible'|'not_supported' } } }
const fs = require('fs'); const path = require('path');
const ROOT = '/Users/alexcriadogonzalez/Camaleonic/get-rid-of-phyllo/poc/src/modules/platforms';
const MAP = { instagram:'Instagram', facebook:'Facebook', tiktok:'TikTok', threads:'Threads', youtube:'YouTube', twitch:'Twitch', linkedin:'LinkedIn' };
const out = {};
for (const [dir, name] of Object.entries(MAP)) {
  const file = path.join(ROOT, dir, dir + '.support-matrix.ts');
  const src = fs.readFileSync(file, 'utf8');
  const body = src.slice(src.indexOf('= {') + 3);
  const lines = body.split('\n');
  const plat = {}; let cur = null;
  for (let raw of lines) {
    const line = raw.replace(/\/\/.*$/, '').trim();      // strip line comments
    if (!line) continue;
    let m;
    if ((m = line.match(/^([a-zA-Z_][\w]*):\s*\{\s*$/))) { cur = m[1]; plat[cur] = {}; continue; }
    if (/^\},?$/.test(line)) { cur = null; continue; }
    if (cur && (m = line.match(/^([a-zA-Z_][\w]*):\s*'(supported|empty_possible|not_supported)'/))) {
      plat[cur][m[1]] = m[2];
    }
  }
  out[name] = plat;
}
fs.writeFileSync('.screenshots/data-guide-mockup/capability.json', JSON.stringify(out, null, 0));
// summary
for (const p of Object.keys(out)) {
  const prods = Object.keys(out[p]);
  console.log(p.padEnd(10), prods.map(pr => pr + '(' + Object.keys(out[p][pr]).length + ')').join(' '));
}
