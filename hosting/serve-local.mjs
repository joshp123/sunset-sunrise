// Written by AI on 2026.10.21 by model GPT-6.1 Sol.
import {createServer} from 'node:http';
import worker from '../dist/server/index.js';
const port = Number(process.argv[2] || 5209);
createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, {method: incoming.method, headers: incoming.headers});
    const response = await worker.fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); outgoing.writeHead(500); outgoing.end('Internal server error'); }
}).listen(port, '127.0.0.1', () => console.log(`Sunset and sunrise: http://127.0.0.1:${port}`));
