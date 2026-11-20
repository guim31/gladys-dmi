import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseCoordinate, parseStationId } from '../src/config.js';
import { resolvePlaces } from '../src/places.js';

test('coordinates typed by hand: comma, spaces, sign, range', () => {
  assert.equal(parseCoordinate('55,6761', 90), 55.6761);
  assert.equal(parseCoordinate(' 12.5683 ', 180), 12.5683);
  assert.equal(parseCoordinate('-51.72', 180), -51.72);
  assert.equal(parseCoordinate('91', 90), null);
  assert.equal(parseCoordinate('55°40′', 90), null);
  assert.equal(parseCoordinate('', 90), null);
});

test('a station id: five digits, the leading zero completed', () => {
  assert.equal(parseStationId('06180'), '06180');
  assert.equal(parseStationId(' 6180 '), '06180');
  assert.equal(parseStationId('Kastrup'), '');
  assert.equal(parseStationId(''), '');
});

test('the defaults, and what a form sends', () => {
  assert.deepEqual(normalizeConfig(), {
    use_houses: true,
    latitude: null,
    longitude: null,
    coordinatesInvalid: false,
    place_name: '',
    station: '',
    stationInvalid: false,
    station_max_km: 50,
    refresh_minutes: 10,
    language: 'fr',
  });
  const config = normalizeConfig({
    use_houses: 'false',
    latitude: '62,0107',
    longitude: '-6.7741',
    place_name: '  Tórshavn ',
    station: 'abc',
    station_max_km: '100',
    refresh_minutes: '7',
    language: 'it',
  });
  assert.equal(config.use_houses, false);
  assert.equal(config.latitude, 62.0107);
  assert.equal(config.place_name, 'Tórshavn');
  assert.equal(config.station, '');
  assert.equal(config.stationInvalid, true);
  assert.equal(config.station_max_km, 100);
  assert.equal(config.refresh_minutes, 10);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ latitude: '62', longitude: 'x' }).coordinatesInvalid, true);
});

test('the places: located houses by selector, typed coordinates by value', () => {
  const places = resolvePlaces(normalizeConfig({ latitude: '62,0107', longitude: '-6.7741' }), [
    { name: 'Home', selector: 'home', latitude: 55.6761, longitude: 12.5683 },
    { name: 'Nowhere', selector: 'nowhere', latitude: null, longitude: null },
  ]);
  assert.deepEqual(
    places.map((place) => [place.platformId, place.name]),
    [
      ['house-home', 'DMI Home'],
      ['point-620107_m67741', 'DMI'],
    ],
  );
});
