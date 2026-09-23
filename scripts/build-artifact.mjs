// Construye una versión de UN SOLO ARCHIVO HTML (JS + CSS + WASM en línea)
// para publicarla como página web (p. ej. un Artifact de claude.ai) y
// poder jugar desde el móvil sin servidor propio.
//   node scripts/build-artifact.mjs  →  artifact/the-last-heir.html
// Las fuentes se cargan desde Google Fonts en lugar de @fontsource.
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = 'dist-artifact';
await build({
  configFile: 'vite.config.ts',
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true, sourcemap: false, assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false },
  plugins: [{
    name: 'stub-fontsource',
    enforce: 'pre',
    resolveId(id) { return id.startsWith('@fontsource/') ? '\0empty-font.css' : null; },
    load(id) { return id === '\0empty-font.css' ? '' : null; },
  }],
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`Se esperaba 1 JS, hay ${js.length}: ${js.join(', ')}`);
const code = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = css.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n').replace(/<\/style/gi, '<\\/style');
const favicon = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath d=%22M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z%22 fill=%22%23b8913a%22/%3E%3C/svg%3E";
const html = `<title>The Last Heir</title>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="description" content="Supervivencia medieval en primera persona: Robledo, 1497.">
<link rel="icon" href="${favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600&family=IM+Fell+English:ital@0;1&display=swap">
<style>
${style}
</style>
<div id="game-root">
  <canvas id="game-canvas"></canvas>
  <div id="ui-root"></div>
</div>
<script type="module">
${code}
</script>
`;
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/the-last-heir.html', html);
console.log(`artifact/the-last-heir.html  ${(html.length / 1024 / 1024).toFixed(2)} MB`);
