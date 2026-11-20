// -----------------------------------------------------------------------------
// The DMI stations (metObs v2, `station` collection), in Denmark, Greenland
// and the Faroe Islands. A station appears once per validity period: the
// query asks for the periods valid now. Only the stations measuring the air
// temperature are weather stations; the others (rain gauges, snow) are left.
// -----------------------------------------------------------------------------

import { distanceKm } from './geo.js';

/**
 * @param {any} json GeoJSON FeatureCollection
 * @returns {{ id: string, name: string, country: string, latitude: number, longitude: number,
 *   parameters: string[] }[]}
 */
export function parseStations(json) {
  if (!json || !Array.isArray(json.features)) {
    throw new Error('the answer holds no station');
  }
  const stations = new Map();
  for (const feature of json.features) {
    const p = feature?.properties ?? {};
    const [longitude, latitude] = feature?.geometry?.coordinates ?? [];
    if (
      typeof p.stationId !== 'string' ||
      !/^\d{5}$/.test(p.stationId) ||
      !Array.isArray(p.parameterId) ||
      !p.parameterId.includes('temp_dry') ||
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      stations.has(p.stationId)
    ) {
      continue;
    }
    stations.set(p.stationId, {
      id: p.stationId,
      name: String(p.name ?? p.stationId).trim() || p.stationId,
      country: String(p.country ?? ''),
      latitude,
      longitude,
      parameters: [...p.parameterId],
    });
  }
  return [...stations.values()];
}

// A station measuring only the temperature and the humidity (some urban
// stations) is skipped by the automatic choice: the nearest station also
// measuring the wind describes the weather better.
const CORE_PARAMETERS = ['temp_dry', 'wind_speed'];

/**
 * The station of a place: the one asked for, or the nearest complete one.
 * @param {ReturnType<typeof parseStations>} stations
 * @param {{ latitude: number, longitude: number }} place
 * @param {{ stationId?: string, maxKm: number }} options
 * @returns {{ station: object, distance: number } | null}
 */
export function stationFor(stations, place, { stationId = '', maxKm }) {
  const withDistance = (station) => ({
    station,
    distance:
      Math.round(
        distanceKm(place.latitude, place.longitude, station.latitude, station.longitude) * 10,
      ) / 10,
  });
  if (stationId) {
    const chosen = stations.find((station) => station.id === stationId);
    return chosen ? withDistance(chosen) : null;
  }
  let best = null;
  for (const station of stations) {
    if (!CORE_PARAMETERS.every((parameter) => station.parameters.includes(parameter))) {
      continue;
    }
    const candidate = withDistance(station);
    if (candidate.distance <= maxKm && (!best || candidate.distance < best.distance)) {
      best = candidate;
    }
  }
  return best;
}
