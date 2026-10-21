const manifestKey = 'ip-location/current.json';
const manifestLifetimeMs = 60_000;
const recordBytes = 50;
let cachedTable;

export function clearIpLocationCache() {
  cachedTable = undefined;
}

export function parseIpAddress(address) {
  if (typeof address !== 'string') return null;
  const text = address.trim();
  const ipv4 = text.split('.');
  if (ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const bytes = new Uint8Array(16);
    bytes.set(ipv4.map(Number), 12);
    return { family: 4, bytes };
  }
  if (!text.includes(':') || !/^[0-9a-f:.]+$/i.test(text)) return null;
  let expanded = text;
  if (expanded.includes('.')) {
    const lastColon = expanded.lastIndexOf(':');
    const tail = parseIpAddress(expanded.slice(lastColon + 1));
    if (!tail || tail.family !== 4) return null;
    expanded = `${expanded.slice(0, lastColon)}:${((tail.bytes[12] << 8) | tail.bytes[13]).toString(16)}:${((tail.bytes[14] << 8) | tail.bytes[15]).toString(16)}`;
  }
  const halves = expanded.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (![...left, ...right].every(part => /^[0-9a-f]{1,4}$/i.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 255;
  });
  if (bytes.slice(0, 10).every(value => value === 0) && bytes[10] === 255 && bytes[11] === 255) {
    bytes.fill(0, 0, 12);
    return { family: 4, bytes };
  }
  return { family: 6, bytes };
}

function compareAddress(bytes, offset, address) {
  for (let index = 0; index < 16; index++) {
    const difference = bytes[offset + index] - address[index];
    if (difference) return difference;
  }
  return 0;
}

function lastStartAtOrBefore(bytes, stride, count, address) {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareAddress(bytes, middle * stride, address) <= 0) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

async function loadTable(bucket) {
  const now = Date.now();
  if (cachedTable && cachedTable.expiresAt > now) return cachedTable;
  const manifestObject = await bucket.get(manifestKey);
  if (!manifestObject) return null;
  const manifest = await manifestObject.json();
  if (manifest.version === cachedTable?.manifest.version) {
    cachedTable.expiresAt = now + manifestLifetimeMs;
    return cachedTable;
  }
  if (manifest.format !== 'dbip-city-ranges-v1' || manifest.recordBytes !== recordBytes) {
    throw new Error('Unsupported IP location table format');
  }
  const indexes = {};
  await Promise.all([4, 6].map(async family => {
    const description = manifest.families[family];
    const object = await bucket.get(description.indexKey);
    if (!object) throw new Error('IP location index is missing');
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.length !== Math.ceil(description.rows / manifest.chunkRecords) * 16) {
      throw new Error('IP location index has an invalid length');
    }
    indexes[family] = bytes;
  }));
  cachedTable = { manifest, indexes, expiresAt: now + manifestLifetimeMs };
  return cachedTable;
}

export async function lookupIpLocation(bucket, address) {
  const parsed = parseIpAddress(address);
  if (!bucket || !parsed) return null;
  const table = await loadTable(bucket);
  if (!table) return null;
  const { manifest, indexes } = table;
  const description = manifest.families[parsed.family];
  const index = indexes[parsed.family];
  const chunk = lastStartAtOrBefore(index, 16, index.length / 16, parsed.bytes);
  if (chunk < 0) return null;
  const firstRecord = chunk * manifest.chunkRecords;
  const part = Math.floor(firstRecord / manifest.partRecords);
  const offset = (firstRecord % manifest.partRecords) * recordBytes;
  const records = Math.min(manifest.chunkRecords, description.rows - firstRecord);
  const length = records * recordBytes;
  const object = await bucket.get(description.partKeys[part], { range: { offset, length } });
  if (!object) throw new Error('IP location data part is missing');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length !== length) throw new Error('IP location data range has an invalid length');
  const row = lastStartAtOrBefore(bytes, recordBytes, records, parsed.bytes);
  if (row < 0 || compareAddress(bytes, row * recordBytes + 16, parsed.bytes) < 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + row * recordBytes, recordBytes);
  return {
    country: String.fromCharCode(view.getUint8(48), view.getUint8(49)),
    latitude: view.getFloat64(32, true),
    longitude: view.getFloat64(40, true),
  };
}
