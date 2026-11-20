// -----------------------------------------------------------------------------
// The public DMI Open Data endpoints the integration reads. No account, no
// key since December 2025. Licence: Creative Commons Attribution 4.0 (credit
// "Danish Meteorological Institute (DMI)").
//
// The service answers 429 "Server is busy" as soon as a few requests arrive
// together, from any client: the requests are serialized here, spaced by a
// second, and a 429 is retried twice after a pause.
// -----------------------------------------------------------------------------

import { parseForecast } from './forecast.js';
import { distanceKm } from './geo.js';
import { parseObservations } from './observations.js';
import { parseStations } from './stations.js';

export { distanceKm };

export const BASE_URL = 'https://opendataapi.dmi.dk';

// The surface parameters of the HARMONIE models read for a place.
export const FORECAST_PARAMETERS = [
  'temperature-2m',
  'relative-humidity-2m',
  'pressure-sealevel',
  'wind-speed-10m',
  'gust-wind-speed-10m',
  'wind-dir-10m',
  'fraction-of-cloud-cover',
  'total-precipitation',
];

// HARMONIE DINI covers Denmark, the Faroe Islands, Iceland and the North
// Sea; HARMONIE IG covers Greenland. Tried in this order.
export const FORECAST_MODELS = ['harmonie_dini_sf', 'harmonie_ig_sf'];

// A point outside a model grid is not refused: the API answers with the
// nearest grid cell, at the edge, hundreds of kilometres away. Beyond this
// distance the place is outside that model.
export const MAX_GRID_DISTANCE_KM = 10;

const TIMEOUT_MS = 30_000;
const SPACING_MS = 1_000;
const RETRY_DELAYS_MS = [5_000, 15_000];
const USER_AGENT = 'gladys-dmi (+https://github.com/guim31/gladys-dmi)';

export class DmiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, outOfArea?: boolean }} [details]
   */
  constructor(message, { status, outOfArea = false } = {}) {
    super(message);
    this.name = 'DmiError';
    this.status = status;
    this.outOfArea = outOfArea;
  }
}

/** The API takes at most four decimals here (about 10 m). */
const coordinate = (value) => String(Math.round(value * 1e4) / 1e4);

export function forecastUrl(model, latitude, longitude) {
  const point = encodeURIComponent(`POINT(${coordinate(longitude)} ${coordinate(latitude)})`);
  return (
    `${BASE_URL}/v1/forecastedr/collections/${model}/position?coords=${point}` +
    `&crs=crs84&parameter-name=${FORECAST_PARAMETERS.join(',')}&f=CoverageJSON`
  );
}

export function observationsUrl(stationId) {
  return `${BASE_URL}/v2/metObs/collections/observation/items?stationId=${encodeURIComponent(stationId)}&period=latest-hour&limit=300`;
}

export function stationsUrl(now) {
  return `${BASE_URL}/v2/metObs/collections/station/items?status=Active&datetime=${now.toISOString()}&limit=1000`;
}

/**
 * The HTTP side: one request at a time, spaced, 429 retried.
 * @param {{ fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>, spacing?: number }} [options]
 */
export function createClient({
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()),
  spacing = SPACING_MS,
} = {}) {
  let queue = Promise.resolve();
  let last = 0;

  async function once(url) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Never the URL: it carries the coordinates of the home.
      const reason = err?.name === 'TimeoutError' ? 'no answer within 30 s' : err?.message;
      throw new DmiError(`DMI unreachable (${reason})`);
    }
    if (!response.ok) {
      throw new DmiError(`DMI answered HTTP ${response.status}`, { status: response.status });
    }
    try {
      return await response.json();
    } catch {
      throw new DmiError('DMI sent an unreadable answer');
    }
  }

  async function getJson(url) {
    for (let attempt = 0; ; attempt += 1) {
      const wait = last + spacing - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      last = Date.now();
      try {
        return await once(url);
      } catch (err) {
        if (err.status !== 429 || attempt >= RETRY_DELAYS_MS.length) {
          throw err;
        }
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  /** Serialized: the next request starts when the previous one has ended. */
  const serial = (url) => {
    const run = queue.then(() => getJson(url));
    queue = run.catch(() => {});
    return run;
  };

  return {
    /**
     * The forecast of a point, from the first model whose grid holds it.
     * @returns {Promise<ReturnType<typeof parseForecast> & { model: string }>}
     */
    async forecast(latitude, longitude) {
      for (const model of FORECAST_MODELS) {
        const json = await serial(forecastUrl(model, latitude, longitude));
        let forecast;
        try {
          forecast = parseForecast(json);
        } catch (err) {
          throw new DmiError(`DMI forecast: ${err.message}`);
        }
        if (
          distanceKm(latitude, longitude, forecast.latitude, forecast.longitude) <=
          MAX_GRID_DISTANCE_KM
        ) {
          return { ...forecast, model };
        }
      }
      throw new DmiError('outside the DMI forecast models', { outOfArea: true });
    },

    /** The latest value of every parameter a station reported in the last hour. */
    async observations(stationId) {
      const json = await serial(observationsUrl(stationId));
      try {
        return parseObservations(json);
      } catch (err) {
        throw new DmiError(`DMI observations: ${err.message}`);
      }
    },

    /** The active stations measuring the air temperature. */
    async stations(now = new Date()) {
      const json = await serial(stationsUrl(now));
      try {
        return parseStations(json);
      } catch (err) {
        throw new DmiError(`DMI stations: ${err.message}`);
      }
    },
  };
}
