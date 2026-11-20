// -----------------------------------------------------------------------------
// Integration configuration: defaults (mirroring the manifest `config_schema`)
// and normalization, so the rest of the code never deals with `undefined` or
// with the strings a form sends.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const REFRESH_MINUTES = ['10', '20', '30', '60'];
export const STATION_DISTANCES = ['25', '50', '100'];

// Defaults: they MUST stay equal to the `default` values of the manifest
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  use_houses: true,
  latitude: '',
  longitude: '',
  place_name: '',
  station: '',
  station_max_km: '50',
  refresh_minutes: '10',
  language: 'fr',
};

/**
 * Parse a coordinate typed by hand: "55.6761", "55,6761", " 12.57 ".
 * @param {unknown} raw
 * @param {number} limit 90 for a latitude, 180 for a longitude
 * @returns {number | null} null when empty or invalid
 */
export function parseCoordinate(raw, limit) {
  const text = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (text === '' || !/^[-+]?\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * A DMI station id: five digits ("06180"); "6180" is completed. Empty when
 * nothing usable was typed.
 */
export function parseStationId(raw) {
  const text = String(raw ?? '').trim();
  return /^\d{4,5}$/.test(text) ? text.padStart(5, '0') : '';
}

/**
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  const language = String(config.language);
  const refresh = String(config.refresh_minutes);
  const distance = String(config.station_max_km);
  const latitudeText = String(config.latitude ?? '').trim();
  const longitudeText = String(config.longitude ?? '').trim();
  const latitude = parseCoordinate(latitudeText, 90);
  const longitude = parseCoordinate(longitudeText, 180);
  const stationText = String(config.station ?? '').trim();
  const station = parseStationId(stationText);
  return {
    use_houses: config.use_houses !== false && config.use_houses !== 'false',
    latitude,
    longitude,
    // Something was typed but cannot be read: said in the logs and the status.
    coordinatesInvalid:
      (latitudeText !== '' || longitudeText !== '') && (latitude === null || longitude === null),
    place_name: String(config.place_name ?? '')
      .trim()
      .slice(0, 60),
    station,
    stationInvalid: stationText !== '' && station === '',
    station_max_km: Number(STATION_DISTANCES.includes(distance) ? distance : '50'),
    refresh_minutes: Number(REFRESH_MINUTES.includes(refresh) ? refresh : '10'),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}
