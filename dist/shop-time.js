// Indianapolis civil time and offline solar calculations. The solar equations
// follow NOAA's implementation of Jean Meeus, Astronomical Algorithms.
// Sources and independently checked event times: ../art/shop-time-sources.md.
export const SHOP_TIME_ZONE = 'America/Indiana/Indianapolis';
// Default morning reopening; the requested closing time is 8 PM.
export const OPENING_HOUR = 9;

const LATITUDE = 39.7684;
const LONGITUDE = -86.1581;
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const localParts = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
});
const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric',
});
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

function instant(value) {
  if (!(value instanceof Date) && typeof value !== 'number') {
    throw new TypeError('Time must be a Date or a timestamp in milliseconds.');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid time.');
  return date;
}

function civilParts(date) {
  return Object.fromEntries(localParts.formatToParts(date)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

/** Real Indiana Eastern time; the browser's own timezone never changes it. */
export function shopTime(now = new Date()) {
  const date = instant(now);
  const p = civilParts(date);
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const second = Number(p.second);
  const minutes = hour * 60 + minute + second / 60 + date.getUTCMilliseconds() / 60_000;
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    hour, minute, second, minutes,
    timeLabel: clockFormat.format(date),
    dayLabel: dayFormat.format(date),
    isClosingSoon: hour === 19 && minute === 59,
    isClosed: hour >= 20 || hour < OPENING_HOUR,
    openingHour: OPENING_HOUR,
    closingHour: 20,
  };
}

/** Stable daily story key: the overnight session lasts until morning reopening. */
export function sessionDay(now = new Date()) {
  const time = shopTime(now);
  if (time.hour >= OPENING_HOUR) return time.dateKey;
  const [year, month, day] = time.dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

// Equation of time (minutes) and apparent solar declination (radians).
function solarCoordinates(timestamp) {
  const julianDay = timestamp / DAY_MS + 2440587.5;
  const t = (julianDay - 2451545) / 36525;
  const meanLongitude = modulo(280.46646 + t * (36000.76983 + t * 0.0003032), 360) * RAD;
  const meanAnomaly = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * RAD;
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center = Math.sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * meanAnomaly) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparentLongitude = meanLongitude + (center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const obliquity = (23 + (26 + seconds / 60) / 60 + 0.00256 * Math.cos(omega)) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude));
  const y = Math.tan(obliquity / 2) ** 2;
  const equationOfTime = (y * Math.sin(2 * meanLongitude)
    - 2 * eccentricity * Math.sin(meanAnomaly)
    + 4 * eccentricity * y * Math.sin(meanAnomaly) * Math.cos(2 * meanLongitude)
    - 0.5 * y * y * Math.sin(4 * meanLongitude)
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly)) / RAD * 4;
  return { declination, equationOfTime };
}

function solarEvent(utcMidnight, horizonDegrees, rising) {
  let eventMinutes = 720 - 4 * LONGITUDE;
  // Re-evaluate declination at the event itself, including events on the next
  // UTC date. Three iterations converge well below one second here.
  for (let i = 0; i < 3; i += 1) {
    const { declination, equationOfTime } = solarCoordinates(utcMidnight + eventMinutes * 60_000);
    const cosine = (Math.sin(horizonDegrees * RAD)
      - Math.sin(LATITUDE * RAD) * Math.sin(declination))
      / (Math.cos(LATITUDE * RAD) * Math.cos(declination));
    const hourAngle = Math.acos(clamp(cosine, -1, 1)) / RAD * (rising ? 1 : -1);
    eventMinutes = 720 - 4 * (LONGITUDE + hourAngle) - equationOfTime;
  }
  return utcMidnight + eventMinutes * 60_000;
}

let cachedDayKey;
let cachedEvents;

/** Sunrise/set and civil twilight for the current Indianapolis calendar day. */
export function solarDay(now = new Date()) {
  const date = instant(now);
  const p = civilParts(date);
  const key = `${p.year}-${p.month}-${p.day}`;
  if (key !== cachedDayKey) {
    const utcMidnight = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
    cachedEvents = {
      sunrise: solarEvent(utcMidnight, -0.833, true),
      sunset: solarEvent(utcMidnight, -0.833, false),
      dawn: solarEvent(utcMidnight, -6, true),
      dusk: solarEvent(utcMidnight, -6, false),
    };
    cachedDayKey = key;
  }
  // Return independent Dates so callers cannot mutate the cached events.
  return {
    sunrise: new Date(cachedEvents.sunrise), sunset: new Date(cachedEvents.sunset),
    dawn: new Date(cachedEvents.dawn), dusk: new Date(cachedEvents.dusk),
    latitude: LATITUDE, longitude: LONGITUDE,
  };
}

/** Smooth scene-light weights. Altitude is geometric, in radians. */
export function solarLight(now = new Date()) {
  const date = instant(now);
  const { declination, equationOfTime } = solarCoordinates(date.getTime());
  const utcMinutes = modulo(date.getTime(), DAY_MS) / 60_000;
  const trueSolarMinutes = modulo(utcMinutes + equationOfTime + 4 * LONGITUDE, 1440);
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
  const altitude = Math.asin(clamp(Math.sin(LATITUDE * RAD) * Math.sin(declination)
    + Math.cos(LATITUDE * RAD) * Math.cos(declination) * Math.cos(hourAngle), -1, 1));
  // Local east/up/south coordinates match the street's world axes. Lighting
  // follows the sun's actual azimuth as well as its elevation over Indiana.
  const sunDirection = [
    -Math.cos(declination) * Math.sin(hourAngle),
    Math.sin(altitude),
    Math.sin(LATITUDE * RAD) * Math.cos(declination) * Math.cos(hourAngle)
      - Math.cos(LATITUDE * RAD) * Math.sin(declination),
  ];
  const altitudeDegrees = altitude / RAD;
  const daylight = smoothstep(-0.833, 8, altitudeDegrees);
  const night = 1 - smoothstep(-6, -0.833, altitudeDegrees);
  const twilight = (1 - daylight) * (1 - night);
  const { sunrise, sunset } = solarDay(date);
  return { daylight, twilight, altitude, sunDirection, night, sunrise, sunset };
}
