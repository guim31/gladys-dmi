// -----------------------------------------------------------------------------
// The "DMI weather" dashboard widget: for a place, what its station measured
// (the forecast of the hour when no station is near), the next 24 hours and
// the coming days. For a station device: its measurements only.
//
// Budget of the core (8 components, 2 texts): 2 texts + 3 values + 1 chart +
// 1 status. The chart and the days can be hidden. The content is cached by
// the core per settings, language and units: it is localized here.
// -----------------------------------------------------------------------------

import { MAX_OBSERVATION_AGE_MS, MIN_DAY_HOURS } from './devices.js';
import { currentStep, dailySummaries, hourlySteps } from './dmi/forecast.js';
import { CONDITIONS, CONDITION_ICONS, NAMES, TEXT, dayLabel, pick, timeLabel } from './i18n.js';

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const round1 = (value) => Math.round(value * 10) / 10;

/** Values in the unit system of the user ('metric' or 'us'). */
export function unitsFor(units) {
  const us = units === 'us';
  return {
    temperature: (c) => (us ? round1((c * 9) / 5 + 32) : round1(c)),
    temperatureUnit: us ? '°F' : '°C',
    speed: (ms) => (us ? round1(ms * 2.236936) : round1(ms)),
    speedUnit: us ? 'mph' : 'm/s',
    amount: (mm) => (us ? Math.round((mm / 25.4) * 100) / 100 : round1(mm)),
    amountUnit: us ? 'in' : 'mm',
  };
}

const flag = (value) => value !== false && value !== 'false';

/** The fresh observed values of a station, by DMI parameter. */
function freshValues(observations, now) {
  const values = {};
  for (const [parameter, entry] of Object.entries(observations?.values ?? {})) {
    if (now - entry.observed <= MAX_OBSERVATION_AGE_MS) {
      values[parameter] = entry.value;
    }
  }
  return values;
}

/**
 * @param {object} options
 * @param {string | null} options.name name of the device in Gladys, null: none
 * @param {object | null} options.forecast
 * @param {{ name: string } | null} options.station
 * @param {object | null} options.observations
 * @param {Date} options.now
 * @param {string} options.language
 * @param {string} options.units
 * @param {string} [options.timeZone]
 * @param {{ showChart?: boolean, showDays?: boolean }} [options.show]
 */
export function buildWeatherContent({
  name,
  forecast,
  station,
  observations,
  now,
  language,
  units,
  timeZone,
  show = {},
}) {
  const text = pick(TEXT, language);
  if (name === null) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: text.noDevice }],
    };
  }
  const heading = { type: 'text', variant: 'heading', text: truncate(name, 40) };
  const step = forecast ? currentStep(forecast, now) : null;
  const observed = freshValues(observations, now);
  if (!step && observed.temp_dry === undefined) {
    return {
      ttl_seconds: 300,
      components: [heading, { type: 'text', variant: 'body', text: text.noData }],
    };
  }
  const u = unitsFor(units);
  const names = pick(NAMES, language);
  const components = [heading];

  const condition = step ? (pick(CONDITIONS, language)[step.condition] ?? '') : '';
  const observedAt = observations?.values.temp_dry?.observed;
  const source =
    station && observed.temp_dry !== undefined
      ? `${station.name} ${timeLabel(observedAt, language, timeZone)}`
      : step
        ? text.forecast
        : '';
  components.push({
    type: 'text',
    variant: 'caption',
    text: truncate([condition, source].filter(Boolean).join(' · '), 80),
  });

  // Measured when the station measures it, forecast otherwise.
  const temperature = observed.temp_dry ?? step?.temperature ?? null;
  const wind = observed.wind_speed ?? step?.windSpeed ?? null;
  const gust = observed.wind_max ?? step?.windGust ?? null;
  const humidity = observed.humidity ?? step?.humidity ?? null;
  if (temperature !== null) {
    components.push({
      type: 'value',
      value: u.temperature(temperature),
      unit: u.temperatureUnit,
      label: truncate(names.temperature, 24),
      icon: 'thermometer',
    });
  }
  if (wind !== null) {
    components.push({
      type: 'value',
      value: u.speed(wind),
      unit: u.speedUnit,
      label: truncate(
        gust === null ? text.wind : `${text.wind} (${text.gusts} ${u.speed(gust)})`,
        24,
      ),
      icon: 'wind',
    });
  }
  if (humidity !== null) {
    components.push({
      type: 'value',
      value: Math.round(humidity),
      unit: '%',
      label: truncate(text.humidity, 24),
      icon: 'droplet',
    });
  }

  if (forecast && show.showChart !== false) {
    const points = hourlySteps(forecast, now, 24)
      .filter((hour) => hour.temperature !== null)
      .map((hour) => ({ t: hour.time.toISOString(), v: u.temperature(hour.temperature) }));
    if (points.length >= 2) {
      components.push({
        type: 'chart',
        chart_type: 'line',
        title: text.next24h,
        unit: u.temperatureUnit,
        series: [{ name: names.temperature, points }],
      });
    }
  }

  if (forecast && show.showDays !== false) {
    const items = [];
    for (const [index, day] of dailySummaries(forecast, now, timeZone).slice(0, 3).entries()) {
      // Today counts its remaining hours; a partial later day (the end of the
      // run) is left out: its low and high would be wrong.
      if (day.temperatureMin === null || (index > 0 && day.hours < MIN_DAY_HOURS)) {
        continue;
      }
      const precipitation =
        day.precipitation > 0 ? ` · ${u.amount(day.precipitation)} ${u.amountUnit}` : '';
      items.push({
        label: truncate(
          `${dayLabel(day.date, language)} · ${pick(CONDITIONS, language)[day.condition] ?? ''}`,
          40,
        ),
        value: truncate(
          `${Math.round(u.temperature(day.temperatureMin))}° / ${Math.round(u.temperature(day.temperatureMax))}°${precipitation}`,
          40,
        ),
        icon: CONDITION_ICONS[day.condition] ?? 'cloud',
      });
    }
    if (items.length > 0) {
      components.push({ type: 'status', items });
    }
  }
  return { ttl_seconds: 600, components };
}

/**
 * @param {import('./hub.js').DmiHub} hub
 */
export function createWidgets(hub) {
  return {
    weather: {
      async get({ settings = {}, language = 'en', units = 'metric' }) {
        const places = hub.createdPlaces();
        const stations = hub.createdStations();
        const chosenStation =
          settings.device && stations.find((s) => hub.stationId(s) === settings.device);
        const place = chosenStation
          ? null
          : ((settings.device && places.find((p) => hub.placeId(p) === settings.device)) ??
            places[0] ??
            null);
        const station = chosenStation || (place ? hub.stationOf(place)?.station : stations[0]);
        const deviceId = place ? hub.placeId(place) : station ? hub.stationId(station) : null;
        const fallbackName = place?.name ?? (station ? `DMI ${station.name}` : '');
        return buildWeatherContent({
          name: deviceId ? hub.deviceName(deviceId, fallbackName) : null,
          forecast: place ? hub.forecastOf(place) : null,
          station: station ?? null,
          observations: station ? hub.observationsOf(station) : null,
          now: new Date(hub.now()),
          language,
          units,
          timeZone: hub.timeZone,
          show: { showChart: flag(settings.show_chart), showDays: flag(settings.show_days) },
        });
      },
    },
  };
}
