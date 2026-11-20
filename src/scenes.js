// -----------------------------------------------------------------------------
// Scene actions:
// - "Read the DMI forecast": the summary of today, tomorrow or the day after
//   for a place, as outputs the next actions use (a morning message, "if
//   tomorrow drops below 0 °C, notify me");
// - "Read the DMI observation": what the station of a place (or a station
//   device) measured last.
//
// A scene action does not receive the user's language: the texts follow the
// `language` of the configuration. Values are metric.
// -----------------------------------------------------------------------------

import { addDays, dailySummaries, localDate } from './dmi/forecast.js';
import { MIN_DAY_HOURS } from './devices.js';
import { ActionFailure } from './errors.js';
import { CONDITIONS, STATUS, TEXT, pick } from './i18n.js';

export const DAYS = ['today', 'tomorrow', 'day_after'];

export const DAY_NAMES = {
  en: { today: 'Today', tomorrow: 'Tomorrow', day_after: 'The day after tomorrow' },
  fr: { today: "Aujourd'hui", tomorrow: 'Demain', day_after: 'Après-demain' },
  de: { today: 'Heute', tomorrow: 'Morgen', day_after: 'Übermorgen' },
  es: { today: 'Hoy', tomorrow: 'Mañana', day_after: 'Pasado mañana' },
};

export const ERRORS = {
  unknownDevice: {
    en: 'This DMI device is unknown: pick it again in the scene.',
    fr: 'Cet appareil DMI est inconnu : choisissez-le de nouveau dans la scène.',
    de: 'Dieses DMI-Gerät ist unbekannt: Wähl es in der Szene erneut aus.',
    es: 'Este dispositivo DMI es desconocido: elíjalo de nuevo en la escena.',
  },
  noForecast: {
    en: 'No DMI forecast for this day yet.',
    fr: 'Pas encore de prévision du DMI pour ce jour.',
    de: 'Noch keine DMI-Vorhersage für diesen Tag.',
    es: 'Todavía no hay previsión del DMI para este día.',
  },
  noStation: {
    en: 'No DMI station near this place.',
    fr: 'Aucune station du DMI près de ce lieu.',
    de: 'Keine DMI-Station in der Nähe dieses Orts.',
    es: 'Ninguna estación del DMI cerca de este lugar.',
  },
  noObservation: {
    en: 'The DMI station sent no recent measurement.',
    fr: "La station du DMI n'a envoyé aucune mesure récente.",
    de: 'Die DMI-Station hat keine aktuelle Messung gesendet.',
    es: 'La estación del DMI no ha enviado ninguna medición reciente.',
  },
};

/** "Tomorrow in DMI Home: Light rain, 3 to 9 °C, 1.2 mm of precipitation, gusts up to 14 m/s." */
export function summarySentence(day, dayKey, placeName, language) {
  const text = pick(TEXT, language);
  const parts = [
    pick(CONDITIONS, language)[day.condition] ?? '',
    `${Math.round(day.temperatureMin)} ${text.to} ${Math.round(day.temperatureMax)} °C`,
    `${day.precipitation ?? 0} ${text.precipitationMm}`,
    day.windGustMax === null ? '' : `${text.gustsUpTo} ${Math.round(day.windGustMax)} m/s`,
  ];
  return `${pick(DAY_NAMES, language)[dayKey]} ${text.in} ${placeName}: ${parts.filter(Boolean).join(', ')}.`;
}

const withoutMissing = (outputs) =>
  Object.fromEntries(Object.entries(outputs).filter(([, v]) => v !== null && v !== undefined));

const value = (observations, parameter) => {
  const raw = observations.values[parameter]?.value;
  return typeof raw === 'number' ? Math.round(raw * 10) / 10 : null;
};

/**
 * @param {import('./hub.js').DmiHub} hub
 */
export function createSceneActions(hub) {
  const language = () => hub.config?.language ?? 'fr';
  return {
    async get_forecast(fields) {
      const place = hub.placeByDevice(fields.device);
      if (!place) {
        throw new ActionFailure(ERRORS.unknownDevice);
      }
      if (!hub.forecastOf(place)) {
        await hub.refresh({ places: [place], force: true });
      }
      const dayKey = DAYS.includes(fields.day) ? fields.day : 'today';
      const now = new Date(hub.now());
      const target = addDays(localDate(now, hub.timeZone), DAYS.indexOf(dayKey));
      const forecast = hub.forecastOf(place);
      const day = forecast
        ? dailySummaries(forecast, now, hub.timeZone).find((summary) => summary.date === target)
        : null;
      if (
        !day ||
        day.temperatureMin === null ||
        (dayKey !== 'today' && day.hours < MIN_DAY_HOURS)
      ) {
        // Say why: DMI down or the place outside its models, rather than
        // "no forecast for this day".
        const error = hub.forecasts.get(place.platformId)?.error;
        throw new ActionFailure(
          forecast || !error
            ? ERRORS.noForecast
            : error.outOfArea
              ? STATUS.outOfArea
              : STATUS.unreachable,
        );
      }
      const name = hub.deviceName(hub.placeId(place), place.name);
      return withoutMissing({
        temperature_min: day.temperatureMin,
        temperature_max: day.temperatureMax,
        precipitation: day.precipitation,
        wind_gust_max: day.windGustMax,
        condition: pick(CONDITIONS, language())[day.condition] ?? null,
        summary: summarySentence(day, dayKey, name, language()),
      });
    },

    async get_observation(fields) {
      const place = hub.placeByDevice(fields.device);
      const station = place ? hub.stationOf(place)?.station : hub.stationByDevice(fields.device);
      if (!place && !station) {
        throw new ActionFailure(ERRORS.unknownDevice);
      }
      if (!station) {
        throw new ActionFailure(ERRORS.noStation);
      }
      // Not forced: a station read less than half a period ago is not read again.
      await hub.refresh({ places: [], stations: [station] });
      const observations = hub.observationsOf(station);
      const temperature = observations ? value(observations, 'temp_dry') : null;
      if (
        temperature === null ||
        hub.now() - observations.values.temp_dry.observed > 3 * 3_600_000
      ) {
        throw new ActionFailure(ERRORS.noObservation);
      }
      // A value the station does not measure is left out, never 0: a scene
      // "if the wind is below 3 m/s" must not fire on a missing value.
      return withoutMissing({
        temperature,
        humidity: value(observations, 'humidity'),
        wind_speed: value(observations, 'wind_speed'),
        wind_gust: value(observations, 'wind_max'),
        precipitation: value(observations, 'precip_past1h'),
        station: station.name,
        observed_at: observations.values.temp_dry.observed.toISOString(),
      });
    },
  };
}
