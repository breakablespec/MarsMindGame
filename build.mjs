import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const res = await build({ entryPoints: ['src/main.ts'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/style.css', 'utf8');
const page = readFileSync('src/index.html', 'utf8').replace('/*CSS*/', () => css).replace('/*JS*/', () => js);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', page);
// Local preview: same page wrapped in the skeleton the artifact host adds.
writeFileSync('dist/preview.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style></head><body>${page}</body></html>`);
console.log('built', (page.length / 1024).toFixed(1) + ' KB');
