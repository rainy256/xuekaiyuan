import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};
const assets = {};
for (const [url, [file, mime]] of Object.entries(files)) {
  assets[url] = { mime, body: await readFile('web/' + file, 'utf8') };
}
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/server/index.js', 'const webAssets = ' + JSON.stringify(assets) + ';\n' + await readFile('server/worker.js', 'utf8'));
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
