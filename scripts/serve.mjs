import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('out');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain' };
http.createServer(async (req,res)=>{
  try {
    let file = path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if (file !== root && !file.startsWith(root+path.sep)) { res.writeHead(403); res.end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file,'index.html');
    const content = await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'}); res.end(content);
  } catch { res.writeHead(404,{'Content-Type':'text/html'}); res.end(await readFile(path.join(root,'404.html')).catch(()=>'Not found')); }
}).listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log(`DSB preview: http://localhost:${process.env.PORT || 3000}`));
