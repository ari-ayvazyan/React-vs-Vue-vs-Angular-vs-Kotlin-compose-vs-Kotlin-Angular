// Minimal reverse proxy that gzips text responses (like a CDN would). Usage: node gzip-proxy.mjs <listenPort> <targetPort>
import http from 'node:http';
import zlib from 'node:zlib';
const [, , listen, target] = process.argv;
http.createServer((req, res) => {
  const headers = { ...req.headers, host: `localhost:${target}` };
  delete headers['accept-encoding'];
  const p = http.request({ host: 'localhost', port: target, path: req.url, method: req.method, headers }, (up) => {
    const h = { ...up.headers };
    const type = String(h['content-type'] || '');
    const gz = /gzip/.test(req.headers['accept-encoding'] || '') && /text|javascript|json|css|svg|xml/.test(type) && !h['content-encoding'];
    if (gz) { delete h['content-length']; h['content-encoding'] = 'gzip'; h['vary'] = 'Accept-Encoding'; }
    res.writeHead(up.statusCode, h);
    gz ? up.pipe(zlib.createGzip({ level: 6 })).pipe(res) : up.pipe(res);
  });
  p.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(p);
}).listen(listen, () => console.log(`gzip proxy :${listen} -> :${target}`));
