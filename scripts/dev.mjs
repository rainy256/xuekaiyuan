import './build.mjs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { localBindings } from './local-bindings.mjs';

const env = localBindings();
const { default: worker } = await import('../dist/server/index.js');
const source = process.env.YANXIE_DEV_SEED;
if (source) {
  const response = await worker.fetch(new Request('http://localhost/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Archive-Migration-Key': env.MIGRATION_KEY },
    body: await readFile(source, 'utf8'),
  }), env);
  if (!response.ok) throw new Error('Local seed failed: ' + response.status + ' ' + await response.text());
}
const args = process.argv.slice(2);
const port = Number(process.env.PORT || args[args.indexOf('--port') + 1]) || 3000;
createServer(async (req, res) => {
  const headers = new Headers(req.headers);
  headers.set('oai-authenticated-user-id', 'local');
  headers.set('oai-authenticated-user-email', env.OWNER_EMAIL);
  const body = ['GET','HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex:'half' };
  try {
    const response = await worker.fetch(new Request('http://' + req.headers.host + req.url, {
      method: req.method, headers, ...body,
    }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch {
    res.writeHead(500).end();
  }
}).listen(port, '0.0.0.0', () => console.log('Local preview on port ' + port));
