// Written by AI on 2026.10.21 by model GPT-6.1 Sol.
// Solar and clock calculations copied from index.html.
const DEG = Math.PI / 180, DAY_MS = 86400000;
const SIN_SUN_ON_HORIZON = Math.sin(-0.833 * DEG); // centre of the sun 0.833 degrees down: its radius plus refraction
function solarDeclinationAndEquationOfTime(utcMs) {
  const jc = (utcMs / DAY_MS + 2440587.5 - 2451545) / 36525;
  const meanLongitude = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
  const meanAnomaly = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccentricity = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const centre = Math.sin(meanAnomaly * DEG) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(2 * meanAnomaly * DEG) * (0.019993 - 0.000101 * jc) + Math.sin(3 * meanAnomaly * DEG) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const obliquity = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * DEG);
  const declination = Math.asin(Math.sin(obliquity * DEG) * Math.sin(apparentLongitude * DEG));
  const y = Math.tan(obliquity * DEG / 2) ** 2;
  const equationOfTimeMinutes = 4 / DEG * (y * Math.sin(2 * meanLongitude * DEG) - 2 * eccentricity * Math.sin(meanAnomaly * DEG)
    + 4 * eccentricity * y * Math.sin(meanAnomaly * DEG) * Math.cos(2 * meanLongitude * DEG)
    - 0.5 * y * y * Math.sin(4 * meanLongitude * DEG) - 1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * DEG));
  return { declination, equationOfTimeMinutes };
}
// Minutes after 00:00 UTC on dayUtcMs, or { polar: 'night' | 'day' } when the sun does not cross the horizon.
function sunEventUtcMinutes(dayUtcMs, latitude, longitude, event) {
  const direction = event === 'sunset' ? 1 : -1;
  let minutes = 720 - 4 * longitude + direction * 360;
  for (let pass = 0; pass < 3; pass++) {
    const { declination, equationOfTimeMinutes } = solarDeclinationAndEquationOfTime(dayUtcMs + minutes * 60000);
    const cosHourAngle = (SIN_SUN_ON_HORIZON - Math.sin(latitude * DEG) * Math.sin(declination)) / (Math.cos(latitude * DEG) * Math.cos(declination));
    if (cosHourAngle > 1) return { polar: 'night' };
    if (cosHourAngle < -1) return { polar: 'day' };
    minutes = 720 - 4 * longitude - equationOfTimeMinutes + direction * 4 * Math.acos(cosHourAngle) / DEG;
  }
  return { minutes };
}
// ================================================================ Clocks (the browser's own IANA database, read once per zone and year)
const offsetFormatters = new Map();
function intlOffsetMinutes(timeZone, utcMs) {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }); offsetFormatters.set(timeZone, formatter); }
  const match = formatter.formatToParts(utcMs).find(part => part.type === 'timeZoneName').value.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}
const daysInYear = year => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
const dayOfYear = dayUtcMs => (dayUtcMs - Date.UTC(new Date(dayUtcMs).getUTCFullYear(), 0, 1)) / DAY_MS;
const yearOf = dayUtcMs => new Date(dayUtcMs).getUTCFullYear();
const dailyOffsetCache = new Map();
// Each day's offset at noon UTC: a sample each month, and a binary search only where the offset changes.
function dailyOffsets(timeZone, year) {
  const key = `${timeZone}|${year}`;
  let days = dailyOffsetCache.get(key);
  if (days) return days;
  const count = daysInYear(year), at = index => intlOffsetMinutes(timeZone, Date.UTC(year, 0, 1 + index, 12));
  days = new Int16Array(count);
  const samples = Array.from({ length: 12 }, (_, month) => month).map(month => (Date.UTC(year, month, 1) - Date.UTC(year, 0, 1)) / DAY_MS).concat(count - 1);
  const values = samples.map(at);
  for (let i = 0; i < samples.length - 1; i++) {
    const from = samples[i], to = samples[i + 1];
    if (values[i] === values[i + 1]) { days.fill(values[i], from, to + 1); continue; }
    let low = from, high = to;
    while (high - low > 1) { const middle = (low + high) >> 1; if (at(middle) === values[i]) low = middle; else high = middle; }
    days.fill(values[i], from, high); days.fill(values[i + 1], high, to + 1);
  }
  dailyOffsetCache.set(key, days);
  return days;
}
function clockOffset(timeZone, dayUtcMs, clocks) {
  const days = dailyOffsets(timeZone, yearOf(dayUtcMs));
  if (clocks === 'as-they-are') return days[dayOfYear(dayUtcMs)];
  return clocks === 'winter-time' ? Math.min(days[14], days[195]) : Math.max(days[14], days[195]);
}
function localClockMinutes(utcMinutes, offset, event) {
  let minutes = ((utcMinutes + offset) % 1440 + 1440) % 1440;
  if (event === 'sunset' && minutes < 360) minutes += 1440;
  if (event === 'sunrise' && minutes > 1080) minutes -= 1440;
  return minutes;
}
function formatClock(minutes) {
  const rounded = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}
function placeEvent(place, dayUtcMs, event, clocks) {
  const result = sunEventUtcMinutes(dayUtcMs, place.lat, place.lon, event);
  if (result.polar) return result;
  return { minutes: localClockMinutes(result.minutes, clockOffset(place.timeZone, dayUtcMs, clocks), event) };
}
const eventWords = result => result.polar === 'night' ? 'Polar night' : result.polar === 'day' ? 'Midnight sun' : formatClock(result.minutes);


export { placeEvent, eventWords };
