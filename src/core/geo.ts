// Placing the show on Earth.
//
// The show is designed in its own frame: x to the audience's right, y up,
// z toward the audience, origin at the centre of the takeoff grid. With a
// site location (latitude, longitude of the origin) and heading (the compass
// bearing the audience faces), show coordinates map to east/north metres
// and to latitude/longitude. Distances here are a few kilometres at most, so
// a local tangent plane with the WGS84 radii of curvature at the origin is
// accurate to millimetres.

const A = 6378137 // WGS84 semi-major axis (m)
const E2 = 0.00669437999014 // WGS84 first eccentricity squared
const DEG = Math.PI / 180

/** Show (x across, z toward the audience) → east, north (m) for a heading in degrees. */
export function showToEN(x: number, z: number, heading: number): [number, number] {
  const h = heading * DEG, c = Math.cos(h), s = Math.sin(h)
  return [x * c - z * s, -x * s - z * c]
}

/** East, north (m) → show (x, z). */
export function enToShow(e: number, n: number, heading: number): [number, number] {
  const h = heading * DEG, c = Math.cos(h), s = Math.sin(h)
  return [e * c - n * s, -e * s - n * c]
}

/** Metres per degree of latitude and of longitude at a latitude. */
export function metresPerDegree(lat: number): { lat: number; lon: number } {
  const sl = Math.sin(lat * DEG)
  const w = Math.sqrt(1 - E2 * sl * sl)
  const M = (A * (1 - E2)) / (w * w * w) // meridional radius
  const N = A / w // prime vertical radius
  return { lat: M * DEG, lon: N * Math.cos(lat * DEG) * DEG }
}

export interface GeoOrigin { lat: number; lon: number; heading: number }

/** Show coordinates → latitude, longitude. */
export function showToLatLon(x: number, z: number, o: GeoOrigin): [number, number] {
  const [e, n] = showToEN(x, z, o.heading)
  const m = metresPerDegree(o.lat)
  return [o.lat + n / m.lat, o.lon + e / m.lon]
}

/** Latitude, longitude → show coordinates (x, z). */
export function latLonToShow(lat: number, lon: number, o: GeoOrigin): [number, number] {
  const m = metresPerDegree(o.lat)
  return enToShow((lon - o.lon) * m.lon, (lat - o.lat) * m.lat, o.heading)
}

// --- Web map tiles (Web Mercator) ------------------------------------------------------

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}
export function latToTileY(lat: number, z: number): number {
  const r = lat * DEG
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return Math.atan(Math.sinh(n)) / DEG
}

/** Tile zoom whose pixels are about `metresPerPixel` at this latitude. */
export function zoomFor(metresPerPixel: number, lat: number): number {
  const z = Math.log2((156543.03392 * Math.cos(lat * DEG)) / Math.max(1e-3, metresPerPixel))
  return Math.max(1, Math.min(19, Math.round(z)))
}

export const DEFAULT_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILES_ATTRIBUTION = '© OpenStreetMap contributors'

export function tileUrl(template: string, x: number, y: number, z: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** Parse "52.52, 13.405", "52.52 13.405" or a maps link with @lat,lon or ?q=lat,lon. */
export function parseLatLon(text: string): [number, number] | null {
  const m = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ?? text.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ?? text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1]), lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null
}
