// -----------------------------------------------------------------------------
// The DMI client and parsers, on answers recorded from the real API
// (2026-11-20): HARMONIE DINI for Copenhagen, HARMONIE IG for Nuuk, three
// stations, one of them measuring only temperature and humidity.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DmiError, createClient, forecastUrl } from '../src/dmi/client.js';
import { currentStep, dailySummaries, parseForecast } from '../src/dmi/forecast.js';
import { parseObservations } from '../src/dmi/observations.js';
import { parseStations, stationFor } from '../src/dmi/stations.js';
import { forecastAlerts } from '../src/alerts.js';
import {
  FORECAST,
  FORECAST_NUUK,
  HOUSE,
  NOW,
  NUUK,
  OBSERVATIONS,
  STATIONS,
  TIME_ZONE,
  createFakeDmi,
} from './helpers/world.js';

test('the forecast: kelvin, pascal and fractions converted, the accumulated precipitation split per hour', () => {
  const forecast = parseForecast(FORECAST);
  assert.equal(forecast.steps.length, 61);
  assert.equal(forecast.latitude, 55.68035305486726);
  const [first, , , , fifth, sixth] = forecast.steps;
  assert.equal(first.time.toISOString(), '2026-11-20T03:00:00.000Z');
  assert.equal(first.temperature, 2.4); // 275.5558 K
  assert.equal(first.pressure, 993.4); // 99342.56 Pa
  assert.equal(first.humidity, 75);
  assert.equal(first.cloudCover, 0);
  assert.equal(fifth.cloudCover, 100);
  // Accumulated 0.0094 then 0.1067 mm: 0.1 mm fell in the sixth hour.
  assert.equal(fifth.precipitation, 0);
  assert.equal(sixth.precipitation, 0.1);
  // A slightly lower total (model noise) is no negative rain.
  assert.ok(forecast.steps.every((step) => step.precipitation >= 0));
  const total = forecast.steps.reduce((sum, step) => sum + step.precipitation, 0);
  assert.ok(Math.abs(total - 0.7) < 0.15, `about 0.67 mm over the run, got ${total}`);
});

test('the current step is the hour in progress; the days are local days', () => {
  const forecast = parseForecast(FORECAST);
  assert.equal(currentStep(forecast, new Date(NOW)).time.toISOString(), '2026-11-20T09:00:00.000Z');
  const days = dailySummaries(forecast, new Date(NOW), TIME_ZONE);
  assert.deepEqual(
    days.map((day) => [day.date, day.hours]),
    [
      ['2026-11-20', 14],
      ['2026-11-21', 24],
      ['2026-11-22', 17],
    ],
  );
  assert.equal(days[1].temperatureMin, 2.5);
  assert.equal(days[1].temperatureMax, 6.5);
  assert.equal(currentStep(forecast, new Date('2026-11-23T00:00:00Z')), null);
});

test('the conditions: snow below 0 °C, rain, then the sky', () => {
  const nuuk = parseForecast(FORECAST_NUUK);
  assert.equal(currentStep(nuuk, new Date(NOW)).condition, 'snow');
  assert.equal(currentStep(parseForecast(FORECAST), new Date(NOW)).condition, 'clear');
});

test('not a forecast: refused', () => {
  assert.throws(() => parseForecast({}), /no forecast/);
  assert.throws(() => parseForecast({ domain: { axes: { t: { values: [] } } } }), /no forecast/);
});

test('a point outside DINI falls back to IG; outside both, outOfArea', async () => {
  const dmi = createFakeDmi();
  const copenhagen = await dmi.client.forecast(HOUSE.latitude, HOUSE.longitude);
  assert.equal(copenhagen.model, 'harmonie_dini_sf');
  const nuuk = await dmi.client.forecast(NUUK.latitude, NUUK.longitude);
  assert.equal(nuuk.model, 'harmonie_ig_sf');
  // Tokyo: both models answer with a cell at their edge.
  await assert.rejects(dmi.client.forecast(35.68, 139.7), (err) => err.outOfArea === true);
  assert.equal(dmi.forecastCalls(), 5);
  assert.match(
    forecastUrl('harmonie_dini_sf', 55.67614, 12.56833),
    /coords=POINT\(12\.5683%2055\.6761\)/,
  );
});

test('429 "Server is busy" is retried twice, then reported; other errors are not retried', async () => {
  let answers = [429, 429];
  const waits = [];
  const fakeFetch = async () => {
    const status = answers.shift();
    return status
      ? { ok: false, status, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => structuredClone(STATIONS) };
  };
  const client = createClient({
    fetch: fakeFetch,
    sleep: async (ms) => waits.push(ms),
    spacing: 0,
  });
  assert.ok((await client.stations(new Date(NOW))).length > 0);
  assert.deepEqual(waits, [5000, 15000]);

  answers = [429, 429, 429];
  await assert.rejects(client.stations(new Date(NOW)), /HTTP 429/);
  answers = [500];
  await assert.rejects(
    client.stations(new Date(NOW)),
    (err) => err instanceof DmiError && err.status === 500,
  );

  const down = createClient({
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
    spacing: 0,
  });
  await assert.rejects(down.observations('06180'), /DMI unreachable \(fetch failed\)/);
});

test('requests are serialized and spaced', async () => {
  let active = 0;
  let most = 0;
  const waits = [];
  const fakeFetch = async () => {
    active += 1;
    most = Math.max(most, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return { ok: true, status: 200, json: async () => structuredClone(OBSERVATIONS['06180']) };
  };
  const client = createClient({
    fetch: fakeFetch,
    sleep: async (ms) => waits.push(ms),
    spacing: 60_000,
  });
  await Promise.all([
    client.observations('06180'),
    client.observations('06180'),
    client.observations('06180'),
  ]);
  assert.equal(most, 1);
  assert.equal(waits.length, 2, 'the second and third wait for their turn');
});

test('the observations: the latest value of each parameter', () => {
  const kastrup = parseObservations(OBSERVATIONS['06180']);
  assert.equal(kastrup.observedAt.toISOString(), '2026-11-20T08:10:00.000Z');
  assert.equal(kastrup.values.temp_dry.value, 1.4);
  assert.equal(kastrup.values.temp_dry.observed.toISOString(), '2026-11-20T08:10:00.000Z');
  // Hourly parameters keep their last hour.
  assert.equal(kastrup.values.precip_past1h.observed.toISOString(), '2026-11-20T08:00:00.000Z');
  const partial = parseObservations(OBSERVATIONS['06186']);
  assert.equal(partial.values.wind_speed, undefined);
  assert.ok(partial.values.temp_dry);
  assert.throws(() => parseObservations({}), /no observation/);
});

test('the stations: weather stations only; the nearest complete one, a chosen one, a distance limit', () => {
  const stations = parseStations(STATIONS);
  assert.ok(stations.every((station) => station.parameters.includes('temp_dry')));
  assert.ok(
    !stations.some((station) => station.id === '05408'),
    'a rain gauge is not a weather station',
  );
  assert.deepEqual([...new Set(stations.map((station) => station.country))].sort(), [
    'DNK',
    'FRO',
    'GRL',
  ]);

  // Landbohøjskolen (1.9 km) measures no wind: Kastrup airport (8.4 km) is taken.
  const auto = stationFor(stations, HOUSE, { maxKm: 50 });
  assert.equal(auto.station.id, '06180');
  assert.equal(auto.distance, 8.4);
  assert.equal(stationFor(stations, HOUSE, { stationId: '06186', maxKm: 50 }).station.id, '06186');
  assert.equal(stationFor(stations, HOUSE, { stationId: '99999', maxKm: 50 }), null);
  assert.equal(stationFor(stations, HOUSE, { maxKm: 5 }), null);
  assert.equal(stationFor(stations, NUUK, { maxKm: 50 }).station.id, '04250');
});

/** The Copenhagen forecast with some hours replaced. */
function withHours(changes) {
  const json = structuredClone(FORECAST);
  for (const [parameter, index, value] of changes) {
    json.ranges[parameter].values[index] = value;
  }
  return parseForecast(json);
}

test('forecast alerts: frost, storm gusts, heavy rain within 24 hours, dated by their first hour', () => {
  const now = new Date(NOW);
  assert.deepEqual(forecastAlerts(parseForecast(FORECAST), now, TIME_ZONE), [], 'a mild day');

  const frost = forecastAlerts(withHours([['temperature-2m', 20, 270.15]]), now, TIME_ZONE);
  assert.deepEqual(frost, [
    { kind: 'frost', key: 'frost:2026-11-21', value: -3, startsAt: '2026-11-20T23:00:00.000Z' },
  ]);

  const storm = forecastAlerts(withHours([['gust-wind-speed-10m', 25, 26.2]]), now, TIME_ZONE);
  assert.equal(storm[0].kind, 'storm');
  assert.equal(storm[0].key, 'storm:2026-11-21');
  assert.equal(storm[0].value, 26.2);

  // Accumulated totals: +10 mm in each of the hours ending at 15:00, 16:00 and 17:00 UTC → 30 mm within 6 h.
  const json = structuredClone(FORECAST);
  const values = json.ranges['total-precipitation'].values;
  for (let i = 12; i < values.length; i += 1) {
    values[i] += 10 * Math.min(i - 11, 3);
  }
  const rain = forecastAlerts(parseForecast(json), now, TIME_ZONE);
  assert.equal(rain.length, 1);
  assert.equal(rain[0].kind, 'heavy_rain');
  assert.equal(rain[0].startsAt, '2026-11-20T17:00:00.000Z', 'the third wet hour reaches 24 mm');
  assert.ok(rain[0].value >= 30);

  // Beyond 24 hours: not yet.
  assert.deepEqual(forecastAlerts(withHours([['temperature-2m', 50, 260]]), now, TIME_ZONE), []);
});
