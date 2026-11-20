// -----------------------------------------------------------------------------
// The container refreshes by itself (Gladys#3198), the core's onPoll is a
// fallback, only changes and heartbeats are published, logs stay quiet,
// alerts reach the scenes once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FORECAST,
  HOUSE,
  NOW,
  OBSERVATIONS,
  createFakeDmi,
  createWorld,
  settle,
} from './helpers/world.js';
import { STATE_HEARTBEAT_MS } from '../src/hub.js';
import { STATUS } from '../src/i18n.js';
import { parseObservations } from '../src/dmi/observations.js';

const MINUTE = 60_000;

/** Observations of Kastrup moved to `now`, with another temperature. */
function observationsAt(now, temperature) {
  const json = structuredClone(OBSERVATIONS['06180']);
  const shift = now - Date.parse('2026-11-20T08:10:00Z');
  for (const feature of json.features) {
    const p = feature.properties;
    p.observed = new Date(Date.parse(p.observed) + shift).toISOString();
    if (p.parameterId === 'temp_dry' && temperature !== undefined) {
      p.value = temperature;
    }
  }
  return json;
}

/** The Copenhagen forecast moved so that its first hour is `now`. */
function forecastAt(now) {
  const json = structuredClone(FORECAST);
  const start = Math.floor(now / 3_600_000) * 3_600_000 - 3 * 3_600_000;
  json.domain.axes.t.values = json.domain.axes.t.values.map((_, i) =>
    new Date(start + i * 3_600_000).toISOString(),
  );
  return json;
}

/** Mocked clock and console; the world reads the mocked Date. */
function setup(t, { logLevel } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const previous = process.env.LOG_LEVEL;
  if (logLevel === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = logLevel;
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  for (const stream of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  return { lines, now: () => Date.now() };
}

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle();
}

function liveDmi(state = {}) {
  return createFakeDmi({
    forecast: (model) => (model === 'harmonie_dini_sf' ? forecastAt(Date.now()) : 404),
    observations: (id) => (id === '06180' ? observationsAt(Date.now(), state.temperature) : 404),
  });
}

test('the container refreshes the added devices by itself, without onPoll (Gladys#3198)', async (t) => {
  const { now } = setup(t, { logLevel: 'silent' });
  const state = { temperature: 1.4 };
  const dmi = liveDmi(state);
  const { gladys, app, station } = await createWorld({ dmi, timers: true, now });
  t.after(() => app.stop());
  assert.equal(dmi.observationCalls(), 1, 'read at once');
  assert.equal(dmi.forecastCalls(), 1);
  assert.equal(gladys.fake.lastState(station('temperature')), 1.4);

  state.temperature = 2.6;
  await tick(t, 10 * MINUTE);
  assert.equal(dmi.observationCalls(), 2, 'the station every period, no onPoll involved');
  assert.equal(dmi.forecastCalls(), 1, 'the forecast at most once an hour');
  assert.equal(gladys.fake.lastState(station('temperature')), 2.6);
  assert.ok(gladys.fake.widgetRefreshes.includes('weather'), 'the widget is nudged');

  for (let i = 0; i < 5; i += 1) {
    await tick(t, 10 * MINUTE);
  }
  assert.equal(dmi.observationCalls(), 7);
  assert.equal(dmi.forecastCalls(), 2);
  assert.equal(dmi.stationCalls(), 1, 'the station list at start, then once a day');
  for (let i = 0; i < 6 * 24; i += 1) {
    await tick(t, 10 * MINUTE);
  }
  assert.equal(dmi.stationCalls(), 2);
});

test("the core's onPoll is a fallback: it never reads DMI twice in a period", async (t) => {
  const { now } = setup(t, { logLevel: 'silent' });
  const dmi = liveDmi();
  const { gladys, app, devices } = await createWorld({ dmi, timers: true, now });
  t.after(() => app.stop());
  const stationDevice = devices.find((device) => device.external_id.includes(':station:'));
  for (let i = 0; i < 9; i += 1) {
    t.mock.timers.tick(MINUTE);
    assert.deepEqual(await gladys.fake.poll(stationDevice), { success: true });
  }
  assert.equal(dmi.observationCalls(), 1);
  // The timer stalls: the core takes over, once 1.2 periods have passed.
  app.stop();
  t.mock.timers.tick(3 * MINUTE);
  await gladys.fake.poll(stationDevice);
  assert.equal(dmi.observationCalls(), 2);
});

test('devices the user did not add are never read by the timer', async (t) => {
  const { now } = setup(t, { logLevel: 'silent' });
  const dmi = liveDmi();
  const { gladys, app } = await createWorld({ dmi, timers: true, now, created: false });
  t.after(() => app.stop());
  assert.equal(gladys.fake.discoveredDevices.length, 2, 'discovered all the same');
  await tick(t, 60 * MINUTE);
  assert.equal(dmi.forecastCalls() + dmi.observationCalls(), 0);
  assert.equal(gladys.fake.states.length, 0);
});

test('only the values that changed are published, and everything again once per heartbeat', async (t) => {
  const { now } = setup(t, { logLevel: 'silent' });
  const dmi = liveDmi();
  const { gladys, app } = await createWorld({ dmi, timers: true, now });
  t.after(() => app.stop());
  const first = gladys.fake.states.length;
  assert.ok(first >= 20);
  await tick(t, 10 * MINUTE);
  assert.equal(gladys.fake.states.length, first, 'nothing changed');
  await tick(t, STATE_HEARTBEAT_MS);
  assert.ok(gladys.fake.states.length >= 2 * first - 2, 'the heartbeat sends them again');
});

test('a device just added gets all its states at once', async () => {
  const { gladys, app, devices } = await createWorld({ created: false });
  try {
    assert.equal(gladys.fake.states.length, 0);
    const stationDevice = devices.length
      ? devices[0]
      : gladys.fake.discoveredDevices.find((device) => device.external_id.includes(':station:'));
    await gladys.fake.deviceCreated({ ...stationDevice, id: 'x1' });
    await settle();
    assert.equal(
      gladys.fake.states.filter((s) => s.device_feature_external_id.includes(':station:')).length,
      stationDevice.features.length,
    );
    assert.ok(gladys.fake.widgetRefreshes.includes('weather'));
  } finally {
    app.stop();
  }
});

test('DMI down: one warning, the last values kept, one line on its return', async (t) => {
  const { lines, now } = setup(t);
  let down = false;
  const dmi = createFakeDmi({
    forecast: (model) => (down ? 503 : model === 'harmonie_dini_sf' ? forecastAt(Date.now()) : 404),
    observations: () => {
      if (down) {
        throw new TypeError('fetch failed');
      }
      return observationsAt(Date.now());
    },
  });
  const { gladys, app, station } = await createWorld({ dmi, timers: true, now });
  t.after(() => app.stop());
  lines.length = 0;
  down = true;
  await tick(t, 60 * MINUTE);
  const warnings = lines.filter((line) => /WARN/i.test(line));
  assert.equal(warnings.filter((line) => line.includes('observations unavailable')).length, 1);
  assert.equal(warnings.filter((line) => line.includes('forecast unavailable')).length, 1);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: STATUS.unreachable });
  assert.equal(gladys.fake.lastState(station('temperature')), 1.4, 'kept');
  down = false;
  lines.length = 0;
  await tick(t, 10 * MINUTE);
  assert.ok(lines.some((line) => line.includes('the observations are back')));
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('a normal cycle writes nothing at info level, and the coordinates never reach the logs', async (t) => {
  const { lines, now } = setup(t, { logLevel: 'info' });
  const dmi = liveDmi();
  const { app } = await createWorld({ dmi, timers: true, now });
  t.after(() => app.stop());
  lines.length = 0;
  await tick(t, 120 * MINUTE);
  assert.deepEqual(lines, []);
  const all = [];
  process.env.LOG_LEVEL = 'debug';
  t.mock.method(console, 'log', (...args) => all.push(args.join(' ')));
  await tick(t, 60 * MINUTE);
  assert.ok(!all.some((line) => line.includes('55.67') || line.includes('12.56')));
});

test('a station that measures less: only its features, and the station chosen in the configuration', async () => {
  const { gladys, app, station } = await createWorld({ config: { station: '6186' } });
  try {
    const device = gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(':06186'));
    assert.deepEqual(
      device.features.map((feature) => feature.external_id.split(':').pop()),
      ['temperature', 'humidity'],
    );
    assert.equal(
      gladys.fake.lastState(station('temperature', '06186')),
      parseObservations(OBSERVATIONS['06186']).values.temp_dry.value,
    );
  } finally {
    app.stop();
  }
});

test('no station near the place: the forecast only', async () => {
  const far = { ...HOUSE, selector: 'far', latitude: 48.85, longitude: 2.35 };
  const dmi = createFakeDmi({
    forecast: (model) =>
      model === 'harmonie_dini_sf'
        ? {
            ...structuredClone(FORECAST),
            domain: {
              ...FORECAST.domain,
              axes: { ...FORECAST.domain.axes, x: { values: [2.35] }, y: { values: [48.85] } },
            },
          }
        : 404,
  });
  const { gladys, app } = await createWorld({ houses: [far], dmi });
  try {
    assert.deepEqual(
      gladys.fake.discoveredDevices.map((d) => d.external_id.split(':').slice(2).join(':')),
      ['place:house-far'],
    );
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  } finally {
    app.stop();
  }
});

test('the status: no place, unreadable coordinates, unknown station, outside the area', async () => {
  let world = await createWorld({ houses: [] });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: STATUS.noPlace,
  });
  world.app.stop();
  world = await createWorld({ houses: [], config: { latitude: 'abc', longitude: '12' } });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: STATUS.invalidCoordinates,
  });
  world.app.stop();
  world = await createWorld({ config: { station: '99999' } });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: STATUS.unknownStation,
  });
  world.app.stop();
  const tokyo = { ...HOUSE, selector: 'tokyo', latitude: 35.68, longitude: 139.7 };
  world = await createWorld({ houses: [tokyo] });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: STATUS.outOfArea,
  });
  world.app.stop();
});

test('a forecast alert reaches the scenes once, even after a restart', async () => {
  const json = structuredClone(FORECAST);
  json.ranges['temperature-2m'].values[20] = 270.15;
  const dmi = createFakeDmi({ forecast: (model) => (model === 'harmonie_dini_sf' ? json : 404) });
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-dmi-'));
  const first = await createWorld({ dmi, dataDir });
  assert.deepEqual(first.gladys.fake.sceneEvents, [
    {
      key: 'forecast_alert',
      data: {
        device: 'ext:test-integration:place:house-home',
        kind: 'frost',
        value: -3,
        starts_at: '2026-11-20T23:00:00.000Z',
      },
    },
  ]);
  await first.app.hub.refresh({ force: true });
  assert.equal(first.gladys.fake.sceneEvents.length, 1, 'not twice');
  first.app.stop();
  const second = await createWorld({ dmi, dataDir });
  assert.equal(second.gladys.fake.sceneEvents.length, 0, 'not after a restart');
  second.app.stop();
});

test('a new configuration re-publishes the devices and reads again', async () => {
  const { gladys, app, dmi } = await createWorld();
  try {
    const before = dmi.forecastCalls();
    await gladys.fake.configUpdated({ language: 'en' });
    await settle();
    assert.equal(dmi.forecastCalls(), before + 1);
    const place = gladys.fake.discoveredDevices.find((d) => d.external_id.includes(':place:'));
    assert.equal(place.features[0].name, 'Temperature');
  } finally {
    app.stop();
  }
});

test('two devices added at the same time are both read', async () => {
  const { gladys, app, dmi } = await createWorld({ created: false });
  try {
    const [place, station] = gladys.fake.discoveredDevices;
    dmi.calls.length = 0;
    await Promise.all([
      gladys.fake.deviceCreated({ ...place, id: 'p' }),
      gladys.fake.deviceCreated({ ...station, id: 's' }),
    ]);
    await settle();
    const featureIds = (device) => device.features.map((feature) => feature.external_id);
    const published = new Set(gladys.fake.states.map((s) => s.device_feature_external_id));
    assert.ok(
      featureIds(place).some((id) => published.has(id)),
      'the place',
    );
    assert.ok(
      featureIds(station).every((id) => published.has(id)),
      'the station',
    );
  } finally {
    app.stop();
  }
});

test('a frost night is announced once, across midnight; again a day later if it lasts, and after a break', async (t) => {
  const { now } = setup(t, { logLevel: 'silent' });
  let frost = true;
  // Frost every hour from 20:00 to 08:00 UTC, whatever the run.
  const dmi = createFakeDmi({
    forecast: (model) => {
      if (model !== 'harmonie_dini_sf') {
        return 404;
      }
      const json = forecastAt(Date.now());
      json.ranges['temperature-2m'].values = json.domain.axes.t.values.map((time) => {
        const hour = new Date(time).getUTCHours();
        return frost && (hour >= 20 || hour < 8) ? 271.15 : 278.15;
      });
      return json;
    },
    observations: () => observationsAt(Date.now()),
  });
  const { gladys, app } = await createWorld({ dmi, timers: true, now });
  t.after(() => app.stop());
  assert.equal(gladys.fake.sceneEvents.length, 1, 'announced at once');
  // Through the night (midnight local included), every refresh: no repeat.
  for (let i = 0; i < 6 * 20; i += 1) {
    await tick(t, 10 * MINUTE);
  }
  assert.equal(gladys.fake.sceneEvents.length, 1);
  // Still frosty a day after the announcement: one reminder.
  for (let i = 0; i < 6 * 5; i += 1) {
    await tick(t, 10 * MINUTE);
  }
  assert.equal(gladys.fake.sceneEvents.length, 2);
  // The frost leaves the forecast, then comes back: a new episode.
  frost = false;
  await tick(t, 60 * MINUTE);
  frost = true;
  await tick(t, 60 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 3);
});
