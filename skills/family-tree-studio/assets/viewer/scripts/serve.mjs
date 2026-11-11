import http from 'node:http';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { build, projectRoot } from './build.mjs';
import { contained } from './model.mjs';
import { materialPath, materialType, materialDisposition } from './material-policy.mjs';

const index = process.argv.indexOf('--port');
const port = index < 0 ? 4173 : Number(process.argv[index + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Неверный номер порта');
if (!process.argv.includes('--preview')) await build();
const folder = await realpath(path.join(projectRoot, 'dist'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const localPort = server.address()?.port;
  if (![`127.0.0.1:${localPort}`, `localhost:${localPort}`].includes(req.headers.host)) { res.writeHead(403); res.end('Недопустимый адрес сервера'); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    const request = decodeURIComponent(url.pathname);
    const relative = request === '/' ? 'index.html' : request.slice(1);
    let material = null;
    if (relative.startsWith('assets/materials/')) material = materialType(materialPath(relative));
    const file = await realpath(path.join(folder, relative));
    if (!contained(folder, file) || (!material && !types[path.extname(file)])) throw Error('Not found');
    const content = await readFile(file);
    const headers = {
      'Content-Type': material?.mediaType || types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${material ? "'self'" : "'none'"}`,
      'Accept-Ranges': 'bytes',
    };
    if (material) headers['Content-Disposition'] = materialDisposition(path.basename(relative), material.preview === 'download' || url.searchParams.get('download') === '1');
    let start = 0, end = content.length - 1, status = 200;
    if (req.headers.range && req.method === 'GET') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${content.length}` }); res.end(); return; }
      if (match[1]) { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
      else { start = Math.max(0, content.length - Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= content.length || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${content.length}` }); res.end(); return; }
      end = Math.min(end, content.length - 1); status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${content.length}`;
    }
    const body = content.subarray(start, end + 1); headers['Content-Length'] = body.length;
    res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Файл не найден'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
