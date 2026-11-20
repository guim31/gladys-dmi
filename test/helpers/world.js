// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake DMI answering the
// recorded fixtures (through the real client), a temporary /data, and the
// integration wired on top through registerHandlers.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { createClient } from '../../src/dmi/client.js';
import { Store } from '../../src/store.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/dmi/${name}`, import.meta.url), 'utf8'));

// Recorded on 2026-11-20 (HARMONIE run of 03:00 UTC, observations until 08:10 UTC).
export const FORECAST = fixture('forecast-copenhagen.json');
export const FORECAST_NUUK = fixture('forecast-nuuk-ig.json');
export const STATIONS = fixture('stations.json');
export const OBSERVATIONS = {
  '06180': fixture('obs-06180.json'),
  '04250': fixture('obs-04250.json'),
  '06186': fixture('obs-06186.json'),
};

/** What DINI answers for a point outside its grid: the edge cell, far away. */
export const FORECAST_EDGE = structuredClone(FORECAST);
FORECAST_EDGE.domain.axes.x.values = [-43.1698333283029];
FORECAST_EDGE.domain.axes.y.values = [66.45659531349749];

/** Prefix the SDK fake puts in front of every external id. */
export const ID_PREFIX = 'ext:test-integration:';

/** Ten minutes after the last observation of the fixtures. */
export const NOW = Date.parse('2026-11-20T08:20:00Z');
export const TIME_ZONE = 'Europe/Copenhagen';

// Copenhagen city hall, as a Gladys house: the forecast fixture is its cell.
export const HOUSE = {
  id: 'a1b2c3',
  name: 'Home',
  selector: 'home',
  latitude: 55.6761,
  longitude: 12.5683,
};

export const NUUK = {
  id: 'd4',
  name: 'Nuuk',
  selector: 'nuuk',
  latitude: 64.1814,
  longitude: -51.7216,
};

export const settle = async () => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const near = (a, b) => Math.abs(a - b) < 1;

/**
 * A fake DMI. Each handler returns a body, a number (an HTTP error status)
 * or throws (network error).
 * - forecast(model, latitude, longitude)
 * - observations(stationId)
 * - stations()
 */
export function createFakeDmi({
  forecast = (model, latitude, longitude) => {
    if (model === 'harmonie_dini_sf') {
      return near(latitude, HOUSE.latitude) && near(longitude, HOUSE.longitude)
        ? FORECAST
        : FORECAST_EDGE;
    }
    return near(latitude, NUUK.latitude) && near(longitude, NUUK.longitude)
      ? FORECAST_NUUK
      : FORECAST_EDGE;
  },
  observations = (stationId) =>
    OBSERVATIONS[stationId] ?? { type: 'FeatureCollection', features: [] },
  stations = () => STATIONS,
} = {}) {
  const calls = [];
  const fakeFetch = async (url) => {
    const text = String(url);
    calls.push(text);
    const parsed = new URL(text);
    let body;
    const model = parsed.pathname.match(/\/v1\/forecastedr\/collections\/([^/]+)\/position$/);
    if (model) {
      const [, lon, lat] = parsed.searchParams
        .get('coords')
        .match(/^POINT\(([-\d.]+) ([-\d.]+)\)$/);
      body = forecast(model[1], Number(lat), Number(lon));
    } else if (parsed.pathname === '/v2/metObs/collections/observation/items') {
      body = observations(parsed.searchParams.get('stationId'));
    } else if (parsed.pathname === '/v2/metObs/collections/station/items') {
      body = stations();
    } else {
      throw new Error(`Unexpected DMI call: ${text}`);
    }
    if (typeof body === 'number') {
      return { ok: false, status: body, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  const count = (part) => calls.filter((url) => url.includes(part)).length;
  return {
    fetch: fakeFetch,
    calls,
    client: createClient({ fetch: fakeFetch, sleep: async () => {}, spacing: 0 }),
    forecastCalls: () => count('/forecastedr/'),
    observationCalls: () => count('/observation/items'),
    stationCalls: () => count('/station/items'),
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object[]} [options.houses]
 * @param {boolean} [options.created] the user added every discovered device
 * @param {object} [options.dmi] from createFakeDmi
 * @param {boolean} [options.timers]
 * @param {() => number} [options.now]
 * @param {string} [options.dataDir]
 */
export async function createWorld({
  config = {},
  houses = [HOUSE],
  created = true,
  dmi = createFakeDmi(),
  timers = false,
  now = () => NOW,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-dmi-')),
} = {}) {
  const options = (store) => ({
    client: dmi.client,
    store,
    timers: false,
    now,
    timeZone: TIME_ZONE,
  });
  // First pass: what the integration would discover, to "create" it.
  let devices = [];
  if (created) {
    const probe = createFakeGladys({ config, houses });
    const probeApp = registerHandlers(
      probe,
      options(new Store(mkdtempSync(join(tmpdir(), 'gladys-dmi-')))),
    );
    await probe.connect();
    await probeApp.ready;
    devices = probe.fake.discoveredDevices;
    probeApp.stop();
    await probe.disconnect();
    dmi.calls.length = 0;
  }
  const gladys = createFakeGladys({ config, houses, devices });
  const app = registerHandlers(gladys, { ...options(new Store(dataDir)), timers });
  await gladys.connect();
  await app.ready;
  const place = (key, platformId = 'house-home') => `${ID_PREFIX}place:${platformId}:${key}`;
  const station = (key, id = '06180') => `${ID_PREFIX}station:${id}:${key}`;
  return { gladys, app, dmi, dataDir, place, station, devices };
}
