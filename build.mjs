// Builds the game into one self-contained page.
//   dist/index.html        full HTML document (Netlify / any static host)
//   dist/favicon.png, dist/og.png  icon + link preview image
//   .artifact/index.html   body-only version for publishing as a Claude artifact
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const res = await build({ entryPoints: ['src/main.ts'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/style.css', 'utf8');
const page = readFileSync('src/index.html', 'utf8').replace('/*CSS*/', () => css).replace('/*JS*/', () => js);

const site = (process.env.URL || process.env.SITE_URL || '').replace(/\/$/, '');
const title = 'MARS MIND';
const desc = 'Build the colony. Command the AI. Survive Mars. A pixel Mars colony you run in plain language: CORE plans, robots build.';
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07050b">
<meta name="description" content="${desc}">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${site}/og.png">
${site ? `<meta property="og:url" content="${site}/">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@MarsMindGame">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${site}/og.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html,body{margin:0;background:#07050b}[hidden]{display:none!important}</style>
</head>
<body>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', `${head}${page}\n</body>\n</html>\n`);
copyFileSync('assets/logo.png', 'dist/favicon.png');
copyFileSync('assets/og.png', 'dist/og.png');
mkdirSync('.artifact', { recursive: true });
writeFileSync('.artifact/index.html', page);
console.log('built', (page.length / 1024).toFixed(1) + ' KB');
