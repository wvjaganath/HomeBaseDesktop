// Strict CSP guard (README §7.4): the hub sends `style-src 'self'` with no
// 'unsafe-inline', so Svelte markup must not contain inline style="" attributes,
// inline <script> or on*="" string handlers. Use classes or style: directives
// (applied through the CSSOM, which CSP allows).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const bad = [
  { re: /\sstyle="/, why: 'inline style attribute (use a class or a style: directive)' },
  { re: /<script(?![^>]*\blang="ts")(?![^>]*\bmodule\b)[^>]*>/, why: 'inline <script> without lang="ts"' },
  { re: /\son[a-z]+="[^{]/, why: 'string event handler attribute' },
  { re: /\{@html\b/, why: '{@html} raw HTML' },
];

let failures = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.svelte') || p.endsWith('index.html')) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        for (const { re, why } of bad) {
          if (re.test(line)) {
            console.error(`${p}:${i + 1}: ${why}\n  ${line.trim()}`);
            failures++;
          }
        }
      });
    }
  }
}
walk('src');

if (failures > 0) {
  console.error(`\n${failures} CSP problem(s) found.`);
  process.exit(1);
}
console.log('CSP check passed.');
