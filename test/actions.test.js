// -----------------------------------------------------------------------------
// The "Check" action, the two scene actions and the "DMI weather" widget.
// Gladys shows in green what a handler returns and in red what it throws:
// every failure is thrown, with the four-language message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildPlaceDevice, buildStationDevice } from '../src/devices.js';
import { HOUSE, NOW, createFakeDmi, createWorld } from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

const failed = (ack) => {
  assert.equal(ack.success, false);
  assert.equal(typeof ack.error.fr, 'string');
  assert.ok(ack.error.fr.length > 0);
  return ack.error;
};

const placeOf = (devices) => devices.find((d) => d.external_id.includes(':place:'));
const stationOf = (devices) => devices.find((d) => d.external_id.includes(':station:'));

test('check: reports the station and the forecast of every place', async () => {
  const { gladys, app } = await createWorld({ created: false });
  try {
    const ack = await gladys.fake.action('check');
    assert.equal(ack.success, true);
    assert.equal(
      ack.data.message.fr,
      'DMI Home: station Københavns Lufthavn (8.4 km) 1.4 °C observé, prévision 3.3 °C, Dégagé.',
    );
    assert.deepEqual(Object.keys(ack.data.message), LANGS);
  } finally {
    app.stop();
  }
});

test('check: fails in red when DMI does not answer, or when there is no place', async () => {
  const dmi = createFakeDmi({ forecast: () => 503, observations: () => 503 });
  let world = await createWorld({ dmi });
  failed(await world.gladys.fake.action('check'));
  world.app.stop();
  world = await createWorld({ houses: [] });
  assert.match(failed(await world.gladys.fake.action('check')).en, /No location/);
  world.app.stop();
});

test('scene action "Read the DMI forecast": one day, and its failures', async () => {
  const { gladys, app, devices } = await createWorld({ config: { language: 'en' } });
  try {
    const device = placeOf(devices).external_id;
    const ack = await gladys.fake.sceneAction('get_forecast', { device, day: 'tomorrow' });
    assert.equal(ack.success, true);
    assert.deepEqual(ack.data.outputs, {
      temperature_min: 2.5,
      temperature_max: 6.5,
      precipitation: 0.5,
      wind_gust_max: 11,
      condition: 'Clear',
      summary:
        'Tomorrow in DMI Home: Clear, 3 to 7 °C, 0.5 mm of precipitation, gusts up to 11 m/s.',
    });
    assert.match(
      failed(await gladys.fake.sceneAction('get_forecast', { device: 'nope' })).en,
      /unknown/,
    );
  } finally {
    app.stop();
  }
  // Outside the DMI models: said as such, not "no forecast for this day".
  const tokyo = await createWorld({
    config: { language: 'en' },
    houses: [{ ...HOUSE, latitude: 35.68, longitude: 139.7 }],
  });
  try {
    const ack = await tokyo.gladys.fake.sceneAction('get_forecast', {
      device: placeOf(tokyo.devices).external_id,
      day: 'today',
    });
    assert.match(failed(ack).en, /Outside the DMI forecast area/);
  } finally {
    tokyo.app.stop();
  }
  // A forecast that ends tomorrow morning: nothing for the day after.
  const short = createFakeDmi();
  const world = await createWorld({ dmi: short, now: () => NOW + 30 * 3_600_000 });
  try {
    const device = placeOf(world.devices).external_id;
    failed(await world.gladys.fake.sceneAction('get_forecast', { device, day: 'day_after' }));
  } finally {
    world.app.stop();
  }
});

test('scene action "Read the DMI station": by place or by station, and its failures', async () => {
  const { gladys, app, devices } = await createWorld();
  try {
    for (const device of [placeOf(devices), stationOf(devices)]) {
      const ack = await gladys.fake.sceneAction('get_observation', { device: device.external_id });
      assert.equal(ack.success, true);
      assert.equal(ack.data.outputs.temperature, 1.4);
      assert.equal(ack.data.outputs.station, 'Københavns Lufthavn');
      assert.equal(ack.data.outputs.observed_at, '2026-11-20T08:10:00.000Z');
    }
    failed(await gladys.fake.sceneAction('get_observation', { device: 'nope' }));
  } finally {
    app.stop();
  }
  // A station that measures no wind: the wind outputs are left out, never 0.
  const partial = await createWorld({ config: { station: '06186' } });
  try {
    const ack = await partial.gladys.fake.sceneAction('get_observation', {
      device: stationOf(partial.devices).external_id,
    });
    assert.equal(ack.success, true);
    assert.deepEqual(Object.keys(ack.data.outputs).sort(), [
      'humidity',
      'observed_at',
      'station',
      'temperature',
    ]);
  } finally {
    partial.app.stop();
  }
  // Old measurements only: the station stopped.
  const late = await createWorld({ now: () => NOW + 5 * 3_600_000 });
  try {
    const ack = await late.gladys.fake.sceneAction('get_observation', {
      device: stationOf(late.devices).external_id,
    });
    assert.match(failed(ack).en, /no recent measurement/);
  } finally {
    late.app.stop();
  }
  // A place without a station nearby.
  const far = await createWorld({
    config: { station_max_km: '25' },
    houses: [{ ...HOUSE, latitude: 55.2, longitude: 11.2 }],
  });
  try {
    const ack = await far.gladys.fake.sceneAction('get_observation', {
      device: placeOf(far.devices).external_id,
    });
    assert.match(failed(ack).en, /No DMI station/);
  } finally {
    far.app.stop();
  }
});

test('the widget fits the vocabulary and the budget of the core, in every language and unit', async () => {
  const { gladys, app, devices } = await createWorld();
  try {
    for (const language of LANGS) {
      for (const units of ['metric', 'us']) {
        for (const device of devices) {
          const ack = await gladys.fake.widgetGet('weather', {
            settings: { device: device.external_id },
            language,
            units,
          });
          assert.equal(ack.success, true);
          assert.deepEqual(validateWidgetContent(ack.data.content), [], `${language} / ${units}`);
        }
      }
    }
    const place = await gladys.fake.widgetGet('weather', {
      settings: { device: placeOf(devices).external_id },
      language: 'en',
    });
    const content = place.data.content;
    assert.deepEqual(
      content.components.map((component) => component.type),
      ['text', 'text', 'value', 'value', 'value', 'chart', 'status'],
    );
    assert.equal(content.components[1].text, 'Clear · Københavns Lufthavn 09:10');
    assert.equal(content.components[2].value, 1.4, 'measured, not forecast');
    assert.equal(content.components[6].items.length, 3);

    const station = await gladys.fake.widgetGet('weather', {
      settings: { device: stationOf(devices).external_id },
      language: 'en',
    });
    assert.deepEqual(
      station.data.content.components.map((component) => component.type),
      ['text', 'text', 'value', 'value', 'value'],
    );

    const bare = await gladys.fake.widgetGet('weather', {
      settings: { device: placeOf(devices).external_id, show_chart: false, show_days: false },
      language: 'en',
    });
    assert.deepEqual(
      bare.data.content.components.map((component) => component.type),
      ['text', 'text', 'value', 'value', 'value'],
    );
  } finally {
    app.stop();
  }
});

test('the widget shows the name given in Gladys, and says when there is nothing', async () => {
  const { gladys, app, devices } = await createWorld();
  try {
    gladys.devices.find((d) => d.external_id === placeOf(devices).external_id).name = 'Garden';
    const ack = await gladys.fake.widgetGet('weather', {
      settings: { device: placeOf(devices).external_id },
      language: 'en',
    });
    assert.equal(ack.data.content.components[0].text, 'Garden');
  } finally {
    app.stop();
  }
  const empty = await createWorld({ created: false });
  try {
    const ack = await empty.gladys.fake.widgetGet('weather', { settings: {}, language: 'en' });
    assert.equal(ack.data.content.components[0].text, 'Add a DMI device in Gladys first.');
  } finally {
    empty.app.stop();
  }
});

test('a place has its 15 features, a station only the ones it measures', () => {
  const fake = {
    externalIds: (type, id) => ({
      device: `${type}:${id}`,
      feature: (key) => `${type}:${id}:${key}`,
    }),
  };
  const place = buildPlaceDevice(fake, { platformId: 'p', name: 'P' }, 'en');
  const station = buildStationDevice(
    fake,
    { id: '06180', name: 'S', parameters: ['temp_dry'] },
    'en',
  );
  assert.equal(place.features.length, 15);
  assert.equal(station.features.length, 1);
});
