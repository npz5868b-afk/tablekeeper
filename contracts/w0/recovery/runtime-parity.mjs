import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const fixtures=JSON.parse(readFileSync('fixtures/valid.json','utf8'));
const bytes=JSON.stringify(canonical(fixtures));
console.log(JSON.stringify({runtime:process.version,fixtureCount:fixtures.cases.length,canonicalSha256:createHash('sha256').update(bytes).digest('hex')}));
