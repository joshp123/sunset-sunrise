// Written by AI on 2026.10.21 by model GPT-6.1 Sol.
import {readFile, readdir, mkdir, writeFile, cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync, inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || root);
const assets = {};
const contentTypes = {'.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8'};
async function addAsset(path, file) {
  const bytes = await readFile(file);
  const extension = path.slice(path.lastIndexOf('.'));
  assets[path] = {type: path.endsWith('/+esm') ? 'text/javascript; charset=utf-8' : contentTypes[extension] || 'application/octet-stream', etag: `"${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}"`, data: gzipSync(bytes, {level: 9}).toString('base64')};
}
async function visit(directory, prefix) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = `${prefix}/${entry.name}`, file = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(file, path); else await addAsset(path, file);
  }
}
await addAsset('/index.html', resolve(root, 'index.html'));
await visit(resolve(root, 'data'), '/data');
await visit(resolve(root, 'vendor'), '/vendor');
await addAsset('/share.png', resolve(root, 'hosting/share.png'));
// Decode the existing RGB time-zone PNG once, without shipping a PNG decoder.
const png = await readFile(resolve(root, 'data/zones.png'));
const compressed = [];
let width, height;
for (let offset = 8; offset < png.length;) {
  const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + size);
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) throw new Error('Expected an 8-bit RGB non-interlaced zone PNG'); }
  if (type === 'IDAT') compressed.push(data);
  offset += size + 12;
}
if (width !== 3600 || height !== 1800) throw new Error('Unexpected time-zone raster dimensions');
const scanlines = inflateSync(Buffer.concat(compressed)), rowBytes = width * 3;
const pixels = Buffer.alloc(height * rowBytes), pointZones = Buffer.alloc(width * height * 2);
const paeth = (left, above, upperLeft) => { const prediction = left + above - upperLeft, a = Math.abs(prediction - left), b = Math.abs(prediction - above), c = Math.abs(prediction - upperLeft); return a <= b && a <= c ? left : b <= c ? above : upperLeft; };
for (let row = 0; row < height; row++) {
  const filter = scanlines[row * (rowBytes + 1)];
  for (let column = 0; column < rowBytes; column++) {
    const index = row * rowBytes + column, left = column >= 3 ? pixels[index - 3] : 0, above = row ? pixels[index - rowBytes] : 0, upperLeft = row && column >= 3 ? pixels[index - rowBytes - 3] : 0;
    const prediction = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
    if (prediction === undefined) throw new Error('Unknown PNG filter');
    pixels[index] = scanlines[row * (rowBytes + 1) + column + 1] + prediction;
  }
}
for (let pixel = 0; pixel < width * height; pixel++) { pointZones[pixel * 2] = pixels[pixel * 3]; pointZones[pixel * 2 + 1] = pixels[pixel * 3 + 1]; }
const worker = (await readFile(resolve(root, 'hosting/worker.mjs'), 'utf8')).replace('/*WEB_ASSETS*/ {}', JSON.stringify(assets)).replace("/*POINT_ZONES*/ ''", JSON.stringify(gzipSync(pointZones, {level: 9}).toString('base64')));
for (const directory of ['dist/server']) {
  await mkdir(resolve(output, directory), {recursive: true});
  await writeFile(resolve(output, directory, 'index.js'), worker);
  await cp(resolve(root, 'hosting/solar.mjs'), resolve(output, directory, 'solar.mjs'));
  await cp(resolve(root, 'hosting/ip-location.mjs'), resolve(output, directory, 'ip-location.mjs'));
}
for (const directory of ['dist/.openai']) {
  await mkdir(resolve(output, directory), {recursive: true});
  await cp(resolve(root, '.openai/hosting.json'), resolve(output, directory, 'hosting.json'));
}
console.log(`Packaged ${Object.keys(assets).length} assets in ${output}; Worker ${(Buffer.byteLength(worker) / 1048576).toFixed(2)} MiB.`);
