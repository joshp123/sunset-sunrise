// Written by AI on 2026.10.21 by model GPT-6.1 Sol.
import { placeEvent, eventWords } from './solar.mjs';
const WEB_ASSETS = /*WEB_ASSETS*/ {};
const POINT_ZONES = /*POINT_ZONES*/ '';
const decodedAssets = new Map();
const bytesFromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const unpack = async value => new Uint8Array(await new Response(new Blob([bytesFromBase64(value)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
async function assetBytes(path) {
  if (!decodedAssets.has(path)) decodedAssets.set(path, unpack(WEB_ASSETS[path].data));
  return decodedAssets.get(path);
}
const assetText = async path => new TextDecoder().decode(await assetBytes(path));
let placesPromise, pointZonesPromise, zoneNamesPromise;
const plainName = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ł/g, 'l').toLowerCase();
function places() {
  return placesPromise ??= assetText('/data/cities.json').then(JSON.parse).then(rows => rows.map(([name, lat, lon, population, timeZone, country, capital, labelable, aliases]) => ({name, lat, lon, population, timeZone, capital: !!capital, searchNames: [name, ...(aliases ? aliases.split('|') : [])].map(plainName)})).sort((a, b) => b.population * (b.capital ? 10 : 1) - a.population * (a.capital ? 10 : 1)));
}
async function pointPlace(latitude, longitude, cityPlaces) {
  const zones = await (pointZonesPromise ??= unpack(POINT_ZONES));
  const zoneNames = await (zoneNamesPromise ??= assetText('/data/zones.json').then(JSON.parse).then(names => { names[0] = 'Etc/UTC'; return names; }));
  const column = ((Math.floor((longitude + 180) * 10) % 3600) + 3600) % 3600;
  const row = Math.min(1799, Math.max(0, Math.floor((90 - latitude) * 10)));
  const index = (row * 3600 + column) * 2;
  let near = null, nearestKm = 60;
  for (const place of cityPlaces) {
    if (Math.abs(place.lat - latitude) > 60 / 111) continue;
    const distance = 111 * Math.hypot(place.lat - latitude, (place.lon - longitude) * Math.cos(latitude * Math.PI / 180));
    if (distance < nearestKm) { near = place; nearestKm = distance; }
  }
  return {lat: latitude, lon: longitude, timeZone: zoneNames[(zones[index] << 8) | zones[index + 1]] || 'Etc/UTC', point: true,
    name: near ? `near ${near.name}` : `at ${Math.abs(latitude).toFixed(1)}° ${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(1)}° ${longitude >= 0 ? 'E' : 'W'}`};
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
async function pageWithPreview(url) {
  const params = url.searchParams;
  const dateText = params.get('date');
  let dayUtcMs = dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? Date.parse(dateText + 'T00:00:00Z') : NaN;
  if (!Number.isFinite(dayUtcMs)) { const now = new Date(); dayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()); }
  const event = params.get('show') === 'sunrise' ? 'sunrise' : 'sunset';
  const clocks = ['winter-time', 'summer-time'].includes(params.get('clocks')) ? params.get('clocks') : 'as-they-are';
  const cityPlaces = await places();
  let place;
  if (params.has('point')) {
    const coordinates = params.get('point').split(',').map(Number);
    if (coordinates.length === 2 && coordinates.every(Number.isFinite) && Math.abs(coordinates[0]) <= 90 && Math.abs(coordinates[1]) <= 180) place = await pointPlace(...coordinates, cityPlaces);
  }
  place ??= cityPlaces.find(place => place.searchNames.includes(plainName(params.get('place') || '')));
  const date = new Intl.DateTimeFormat('en-GB', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(dayUtcMs);
  let title = `Sunset and sunrise — ${date}`;
  if (place) {
    const result = placeEvent(place, dayUtcMs, event, clocks);
    const phrase = place.point ? place.name : `in ${place.name}`;
    title = `${eventWords(result)}${result.polar ? '' : ` ${event}`} ${phrase}, ${date}`;
  }
  const clockDescription = clocks === 'winter-time' ? ' With winter time all year.' : clocks === 'summer-time' ? ' With summer time all year.' : '';
  const description = `${title}.${clockDescription} Explore sunset and sunrise times around the world.`;
  const image = `${url.origin}/share.png`;
  const tags = {
    'og:type': 'website', 'og:site_name': 'Sunset and sunrise', 'og:title': title, 'og:description': description,
    'og:url': url.href, 'og:image': image, 'og:image:width': '1200', 'og:image:height': '630', 'og:image:alt': 'Sunset in Rotterdam on Sunday 25 October 2026, with a map of sunset times.',
  };
  const metadata = Object.entries(tags).map(([property, content]) => `<meta property="${property}" content="${escapeHtml(content)}">`).join('\n')
    + `\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${escapeHtml(title)}">\n<meta name="twitter:description" content="${escapeHtml(description)}">\n<meta name="twitter:image" content="${escapeHtml(image)}">`;
  return (await assetText('/index.html')).replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`).replace('</head>', `${metadata}\n</head>`);
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
    if (url.pathname === '/api/home') {
      const latitude = request.cf?.latitude, longitude = request.cf?.longitude;
      const known = latitude !== undefined && latitude !== null && latitude !== '' && longitude !== undefined && longitude !== null && longitude !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
      return new Response(request.method === 'HEAD' ? null : known ? JSON.stringify({latitude: Number(latitude), longitude: Number(longitude)}) : null, {status: known ? 200 : 404, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const page = await pageWithPreview(url);
      return new Response(request.method === 'HEAD' ? null : page, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate'}});
    }
    const asset = WEB_ASSETS[url.pathname];
    if (!asset) return new Response('Not found', {status: 404});
    const headers = {'Content-Type': asset.type, 'Cache-Control': 'public, max-age=3600, must-revalidate', ETag: asset.etag, Vary: 'Accept-Encoding'};
    if (request.headers.get('If-None-Match') === asset.etag) return new Response(null, {status: 304, headers});
    const acceptsGzip = /\bgzip\b/.test(request.headers.get('Accept-Encoding') || '');
    if (acceptsGzip) headers['Content-Encoding'] = 'gzip';
    return new Response(request.method === 'HEAD' ? null : acceptsGzip ? bytesFromBase64(asset.data) : await assetBytes(url.pathname), {headers});
  },
};
