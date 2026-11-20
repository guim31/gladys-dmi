// -----------------------------------------------------------------------------
// The two DMI devices:
// - a station (`station:<DMI id>`): what the nearest DMI weather station
//   measured, with only the features that station measures;
// - a place (`place:<house or point>`): the HARMONIE forecast of the place,
//   for the hour in progress, today and tomorrow.
//
// Feature keys are part of the external ids: never rename one. Every feature
// is read-only. The couples category/type are ones the Gladys front knows
// (test/gladys-rules.test.js); min/max are display bounds (gauges).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { dailySummaries, currentStep, localDate } from './dmi/forecast.js';
import { CONDITIONS, NAMES, pick } from './i18n.js';

export const STATION_TYPE = 'station';
export const PLACE_TYPE = 'place';

// An observation older than this is not published (a station stopped).
export const MAX_OBSERVATION_AGE_MS = 3 * 3_600_000;
// A later day the forecast covers for fewer hours has no meaningful low or
// high. 15 hours from midnight hold the morning low and the afternoon high.
export const MIN_DAY_HOURS = 15;

const sensor = (category, type, unit, min, max) => ({ category, type, unit, min, max });
const text = () => ({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, text: true });
const round1 = (value) => Math.round(value * 10) / 10;

const temperature = () => sensor(C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, U.CELSIUS, -50, 40);
const humidity = () => sensor(C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, U.PERCENT, 0, 100);
const pressure = () => sensor(C.PRESSURE_SENSOR, T.SENSOR.DECIMAL, U.HECTO_PASCAL, 950, 1050);
const windSpeed = () => sensor(C.SPEED_SENSOR, T.SENSOR.DECIMAL, U.METER_PER_SECOND, 0, 40);
const windGust = () => sensor(C.SPEED_SENSOR, T.SENSOR.DECIMAL, U.METER_PER_SECOND, 0, 60);
const windDirection = () => sensor(C.ANGLE_SENSOR, T.SENSOR.INTEGER, U.DEGREE, 0, 360);
// No cloud category in Gladys: a percentage sensor, drawn with a drop.
const cloudCover = () =>
  sensor(C.LEVEL_SENSOR, T.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT, U.PERCENT, 0, 100);
const hourlyPrecipitation = () =>
  sensor(C.PRECIPITATION_SENSOR, T.SENSOR.DECIMAL, U.MILLIMETER_PER_HOUR, 0, 30);
const dailyPrecipitation = () =>
  sensor(C.PRECIPITATION_SENSOR, T.SENSOR.DECIMAL, U.MILLIMETER_PER_DAY, 0, 100);

// Station features: `parameter` is the DMI metObs parameter, `value` turns
// its raw value into the published one (null: not publishable).
export const STATION_FEATURES = [
  { key: 'temperature', ...temperature(), parameter: 'temp_dry', value: round1 },
  {
    key: 'humidity',
    ...humidity(),
    parameter: 'humidity',
    value: (v) => Math.min(Math.max(Math.round(v), 0), 100),
  },
  { key: 'pressure', ...pressure(), parameter: 'pressure_at_sea', value: round1 },
  { key: 'wind-speed', ...windSpeed(), parameter: 'wind_speed', value: round1 },
  // Highest 3-second wind of the last ten minutes: the gust.
  { key: 'wind-gust', ...windGust(), parameter: 'wind_max', value: round1 },
  {
    key: 'wind-direction',
    ...windDirection(),
    parameter: 'wind_dir',
    value: (v) => Math.round(v) % 360,
  },
  {
    key: 'precipitation',
    ...hourlyPrecipitation(),
    parameter: 'precip_past1h',
    value: (v) => round1(Math.max(v, 0)),
  },
  // DMI reports metres.
  {
    key: 'visibility',
    ...sensor(C.DISTANCE_SENSOR, T.SENSOR.DECIMAL, U.KM, 0, 50),
    parameter: 'visibility',
    value: (v) => round1(v / 1000),
  },
  // 113 % in cloud_cover means "sky obscured" (fog): not a cover.
  {
    key: 'cloud-cover',
    ...cloudCover(),
    parameter: 'cloud_cover',
    value: (v) => (v >= 0 && v <= 100 ? Math.round(v) : null),
  },
];

// Place features: `value(step, days)` reads the forecast.
export const PLACE_FEATURES = [
  { key: 'temperature', ...temperature(), value: (step) => step.temperature },
  { key: 'humidity', ...humidity(), value: (step) => step.humidity },
  { key: 'pressure', ...pressure(), value: (step) => step.pressure },
  { key: 'wind-speed', ...windSpeed(), value: (step) => step.windSpeed },
  { key: 'wind-gust', ...windGust(), value: (step) => step.windGust },
  { key: 'wind-direction', ...windDirection(), value: (step) => step.windDirection },
  { key: 'cloud-cover', ...cloudCover(), value: (step) => step.cloudCover },
  { key: 'precipitation', ...hourlyPrecipitation(), value: (step) => step.precipitation },
  { key: 'weather', ...text() },
  {
    key: 'today-temperature-min',
    ...temperature(),
    value: (step, days) => days.today?.temperatureMin,
  },
  {
    key: 'today-temperature-max',
    ...temperature(),
    value: (step, days) => days.today?.temperatureMax,
  },
  {
    key: 'today-precipitation',
    ...dailyPrecipitation(),
    value: (step, days) => days.today?.precipitation,
  },
  {
    key: 'tomorrow-temperature-min',
    ...temperature(),
    value: (step, days) => days.tomorrow?.temperatureMin,
  },
  {
    key: 'tomorrow-temperature-max',
    ...temperature(),
    value: (step, days) => days.tomorrow?.temperatureMax,
  },
  {
    key: 'tomorrow-precipitation',
    ...dailyPrecipitation(),
    value: (step, days) => days.tomorrow?.precipitation,
  },
];

function publishedFeature(ids, feature, names) {
  const published = {
    name: names[feature.key],
    external_id: ids.feature(feature.key),
    category: feature.category,
    type: feature.type,
    read_only: true,
    has_feedback: false,
    keep_history: !feature.text,
    min: feature.min,
    max: feature.max,
  };
  if (feature.unit) {
    published.unit = feature.unit;
  }
  return published;
}

// The container refreshes by itself (src/hub.js): Gladys may not poll a
// device created without these fields (Gladys#3198). Once a minute is the
// slowest pace Gladys schedules; onPoll skips what is fresh.
const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

/** The features a station measures, in display order. */
export function stationFeatures(station) {
  return STATION_FEATURES.filter((feature) => station.parameters.includes(feature.parameter));
}

/**
 * @param {object} gladys GladysIntegration
 * @param {{ id: string, name: string, parameters: string[] }} station
 * @param {string} language language of the feature names
 */
export function buildStationDevice(gladys, station, language) {
  const ids = gladys.externalIds(STATION_TYPE, station.id);
  const names = pick(NAMES, language);
  return {
    name: `DMI ${station.name}`.slice(0, 60),
    external_id: ids.device,
    ...POLLING,
    features: stationFeatures(station).map((feature) => publishedFeature(ids, feature, names)),
  };
}

/**
 * @param {object} gladys GladysIntegration
 * @param {{ platformId: string, name: string }} place
 * @param {string} language language of the feature names
 */
export function buildPlaceDevice(gladys, place, language) {
  const ids = gladys.externalIds(PLACE_TYPE, place.platformId);
  const names = pick(NAMES, language);
  return {
    name: place.name,
    external_id: ids.device,
    ...POLLING,
    features: PLACE_FEATURES.map((feature) => publishedFeature(ids, feature, names)),
  };
}

/**
 * The states of a station, in the publishChangedStates format.
 * @param {object} gladys
 * @param {object} station
 * @param {ReturnType<import('./dmi/observations.js').parseObservations> | null} observations
 * @param {Date} now
 */
export function buildStationStates(gladys, station, observations, now) {
  if (!observations) {
    return [];
  }
  const ids = gladys.externalIds(STATION_TYPE, station.id);
  const states = [];
  for (const feature of stationFeatures(station)) {
    const observed = observations.values[feature.parameter];
    if (!observed || now - observed.observed > MAX_OBSERVATION_AGE_MS) {
      continue;
    }
    const value = feature.value(observed.value);
    if (value !== null && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(feature.key), state: value });
    }
  }
  return states;
}

/** Today's and tomorrow's summaries of a forecast. */
export function daysOf(forecast, now, timeZone) {
  const summaries = dailySummaries(forecast, now, timeZone);
  const today = localDate(now, timeZone);
  const tomorrow = localDate(new Date(now.getTime() + 86_400_000), timeZone);
  return {
    today: summaries.find((day) => day.date === today) ?? null,
    tomorrow: summaries.find((day) => day.date === tomorrow && day.hours >= MIN_DAY_HOURS) ?? null,
  };
}

/**
 * The states of a place, in the publishChangedStates format.
 * @param {object} gladys
 * @param {{ platformId: string }} place
 * @param {object | null} forecast
 * @param {{ language: string, now: Date, timeZone?: string }} options
 */
export function buildPlaceStates(gladys, place, forecast, { language, now, timeZone }) {
  const step = forecast ? currentStep(forecast, now) : null;
  if (!step) {
    return [];
  }
  const ids = gladys.externalIds(PLACE_TYPE, place.platformId);
  const days = daysOf(forecast, now, timeZone);
  const states = [];
  for (const feature of PLACE_FEATURES) {
    if (!feature.value) {
      continue;
    }
    const value = feature.value(step, days);
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(feature.key), state: value });
    }
  }
  const condition = pick(CONDITIONS, language)[step.condition];
  if (condition) {
    states.push({ device_feature_external_id: ids.feature('weather'), text: condition });
  }
  return states;
}
