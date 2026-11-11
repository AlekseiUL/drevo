import http from 'node:http';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { build, projectRoot } from './build.mjs';
import { contained } from './model.mjs';

const index = process.argv.indexOf('--port');
const port = index < 0 ? 4173 : Number(process.argv[index + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Неверный номер порта');
if (!process.argv.includes('--preview')) await build();
const folder = await realpath(path.join(projectRoot, 'dist'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const request = decodeURIComponent(url.pathname);
    const relative = request === '/' ? 'index.html' : request.slice(1);
    const file = await realpath(path.join(folder, relative));
    if (!contained(folder, file) || !types[path.extname(file)]) throw Error('Not found');
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
    res.end(content);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Файл не найден'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
