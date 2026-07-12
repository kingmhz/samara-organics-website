import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp' };

http.createServer(async (request, response) => {
  try {
    const requested = request.url === '/' ? 'index.html' : request.url.split('?')[0].slice(1);
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
    const file = join(process.cwd(), safePath);
    const content = await readFile(file);
    response.writeHead(200, { 
      'Content-Type': types[extname(file)] || 'application/octet-stream', 
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    response.end(content);
  } catch {
    const content = await readFile(join(process.cwd(), '404.html')).catch(() => Buffer.from('Not found'));
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end(content);
  }
}).listen(port, '127.0.0.1', () => console.log(`Samara preview: http://127.0.0.1:${port}`));
