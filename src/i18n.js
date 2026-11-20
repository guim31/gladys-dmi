// -----------------------------------------------------------------------------
// Every text the integration produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js checks the
// tables). Station names stay as DMI writes them.
// -----------------------------------------------------------------------------

/** One entry per language, picked with a fallback to English. */
export const pick = (table, language) => table[language] ?? table.en;

// The simple conditions derived from the forecast (src/dmi/forecast.js).
export const CONDITIONS = {
  en: {
    clear: 'Clear',
    partly_cloudy: 'Partly cloudy',
    cloudy: 'Cloudy',
    light_rain: 'Light rain',
    rain: 'Rain',
    snow: 'Snow',
  },
  fr: {
    clear: 'Dégagé',
    partly_cloudy: 'Partiellement nuageux',
    cloudy: 'Nuageux',
    light_rain: 'Pluie faible',
    rain: 'Pluie',
    snow: 'Neige',
  },
  de: {
    clear: 'Klar',
    partly_cloudy: 'Teilweise bewölkt',
    cloudy: 'Bewölkt',
    light_rain: 'Leichter Regen',
    rain: 'Regen',
    snow: 'Schnee',
  },
  es: {
    clear: 'Despejado',
    partly_cloudy: 'Parcialmente nuboso',
    cloudy: 'Nuboso',
    light_rain: 'Lluvia débil',
    rain: 'Lluvia',
    snow: 'Nieve',
  },
};

export const CONDITION_ICONS = {
  clear: 'sun',
  partly_cloudy: 'cloud',
  cloudy: 'cloud',
  light_rain: 'cloud-drizzle',
  rain: 'cloud-rain',
  snow: 'cloud-snow',
};

// Feature names, frozen when the user adds the device. The station and the
// forecast are two devices: the same name may appear on both.
export const NAMES = {
  en: {
    temperature: 'Temperature',
    humidity: 'Humidity',
    pressure: 'Pressure',
    'wind-speed': 'Wind speed',
    'wind-gust': 'Wind gusts',
    'wind-direction': 'Wind direction',
    'cloud-cover': 'Cloud cover',
    precipitation: 'Precipitation (1 h)',
    visibility: 'Visibility',
    weather: 'Weather',
    'today-temperature-min': 'Low today',
    'today-temperature-max': 'High today',
    'today-precipitation': 'Precipitation today',
    'tomorrow-temperature-min': 'Low tomorrow',
    'tomorrow-temperature-max': 'High tomorrow',
    'tomorrow-precipitation': 'Precipitation tomorrow',
  },
  fr: {
    temperature: 'Température',
    humidity: 'Humidité',
    pressure: 'Pression',
    'wind-speed': 'Vitesse du vent',
    'wind-gust': 'Rafales',
    'wind-direction': 'Direction du vent',
    'cloud-cover': 'Nébulosité',
    precipitation: 'Précipitations (1 h)',
    visibility: 'Visibilité',
    weather: 'Temps',
    'today-temperature-min': "Minimale aujourd'hui",
    'today-temperature-max': "Maximale aujourd'hui",
    'today-precipitation': "Précipitations aujourd'hui",
    'tomorrow-temperature-min': 'Minimale demain',
    'tomorrow-temperature-max': 'Maximale demain',
    'tomorrow-precipitation': 'Précipitations demain',
  },
  de: {
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    pressure: 'Luftdruck',
    'wind-speed': 'Windgeschwindigkeit',
    'wind-gust': 'Windböen',
    'wind-direction': 'Windrichtung',
    'cloud-cover': 'Bewölkung',
    precipitation: 'Niederschlag (1 h)',
    visibility: 'Sichtweite',
    weather: 'Wetter',
    'today-temperature-min': 'Tiefstwert heute',
    'today-temperature-max': 'Höchstwert heute',
    'today-precipitation': 'Niederschlag heute',
    'tomorrow-temperature-min': 'Tiefstwert morgen',
    'tomorrow-temperature-max': 'Höchstwert morgen',
    'tomorrow-precipitation': 'Niederschlag morgen',
  },
  es: {
    temperature: 'Temperatura',
    humidity: 'Humedad',
    pressure: 'Presión',
    'wind-speed': 'Velocidad del viento',
    'wind-gust': 'Rachas de viento',
    'wind-direction': 'Dirección del viento',
    'cloud-cover': 'Nubosidad',
    precipitation: 'Precipitación (1 h)',
    visibility: 'Visibilidad',
    weather: 'Tiempo',
    'today-temperature-min': 'Mínima de hoy',
    'today-temperature-max': 'Máxima de hoy',
    'today-precipitation': 'Precipitación de hoy',
    'tomorrow-temperature-min': 'Mínima de mañana',
    'tomorrow-temperature-max': 'Máxima de mañana',
    'tomorrow-precipitation': 'Precipitación de mañana',
  },
};

// Connection status shown in the Configuration screen.
export const STATUS = {
  noPlace: {
    en: 'No location: give a house a location in Gladys, or enter coordinates.',
    fr: 'Aucun lieu : localisez une maison dans Gladys, ou saisissez des coordonnées.',
    de: 'Kein Ort: Gib einem Haus in Gladys einen Standort oder trag Koordinaten ein.',
    es: 'Ningún lugar: ubique una casa en Gladys o introduzca coordenadas.',
  },
  invalidCoordinates: {
    en: 'The coordinates cannot be read: use decimal degrees, e.g. 55.6761 and 12.5683.',
    fr: 'Coordonnées illisibles : utilisez des degrés décimaux, ex. 55.6761 et 12.5683.',
    de: 'Koordinaten nicht lesbar: Verwende Dezimalgrad, z. B. 55.6761 und 12.5683.',
    es: 'Coordenadas ilegibles: utilice grados decimales, p. ej. 55.6761 y 12.5683.',
  },
  unknownStation: {
    en: 'This DMI station is unknown or inactive: leave the field empty for the nearest one.',
    fr: 'Station DMI inconnue ou inactive : laissez le champ vide pour la plus proche.',
    de: 'Diese DMI-Station ist unbekannt oder inaktiv: Lass das Feld leer für die nächste.',
    es: 'Estación del DMI desconocida o inactiva: deje el campo vacío para la más cercana.',
  },
  outOfArea: {
    en: 'Outside the DMI forecast area (Denmark, Greenland, Faroe Islands, North Sea).',
    fr: 'Hors de la zone de prévision du DMI (Danemark, Groenland, îles Féroé, mer du Nord).',
    de: 'Außerhalb des DMI-Vorhersagegebiets (Dänemark, Grönland, Färöer, Nordsee).',
    es: 'Fuera de la zona de previsión del DMI (Dinamarca, Groenlandia, islas Feroe, mar del Norte).',
  },
  unreachable: {
    en: 'DMI does not answer: the last values are kept, a new try follows.',
    fr: 'Le DMI ne répond pas : les dernières valeurs sont conservées, nouvel essai à suivre.',
    de: 'DMI antwortet nicht: Die letzten Werte bleiben, ein neuer Versuch folgt.',
    es: 'El DMI no responde: se conservan los últimos valores, se volverá a intentar.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

// Short texts of the widget, the action and the scene actions.
export const TEXT = {
  en: {
    noDevice: 'Add a DMI device in Gladys first.',
    noData: 'No data yet.',
    wind: 'Wind',
    gusts: 'Gusts',
    humidity: 'Humidity',
    next24h: 'Next 24 hours',
    observed: 'observed',
    forecast: 'forecast',
    station: 'station',
    noStation: 'no DMI station nearby',
    outside: 'outside the DMI forecast area',
    failed: 'no answer from DMI',
    to: 'to',
    in: 'in',
    precipitationMm: 'mm of precipitation',
    gustsUpTo: 'gusts up to',
  },
  fr: {
    noDevice: "Ajoutez d'abord un appareil DMI dans Gladys.",
    noData: 'Pas encore de données.',
    wind: 'Vent',
    gusts: 'Rafales',
    humidity: 'Humidité',
    next24h: 'Prochaines 24 heures',
    observed: 'observé',
    forecast: 'prévision',
    station: 'station',
    noStation: 'aucune station DMI proche',
    outside: 'hors de la zone de prévision du DMI',
    failed: 'pas de réponse du DMI',
    to: 'à',
    in: 'à',
    precipitationMm: 'mm de précipitations',
    gustsUpTo: "rafales jusqu'à",
  },
  de: {
    noDevice: 'Füg zuerst ein DMI-Gerät in Gladys hinzu.',
    noData: 'Noch keine Daten.',
    wind: 'Wind',
    gusts: 'Böen',
    humidity: 'Feuchte',
    next24h: 'Nächste 24 Stunden',
    observed: 'gemessen',
    forecast: 'Vorhersage',
    station: 'Station',
    noStation: 'keine DMI-Station in der Nähe',
    outside: 'außerhalb des DMI-Vorhersagegebiets',
    failed: 'keine Antwort von DMI',
    to: 'bis',
    in: 'in',
    precipitationMm: 'mm Niederschlag',
    gustsUpTo: 'Böen bis',
  },
  es: {
    noDevice: 'Añada primero un dispositivo DMI en Gladys.',
    noData: 'Todavía no hay datos.',
    wind: 'Viento',
    gusts: 'Rachas',
    humidity: 'Humedad',
    next24h: 'Próximas 24 horas',
    observed: 'observado',
    forecast: 'previsión',
    station: 'estación',
    noStation: 'ninguna estación del DMI cercana',
    outside: 'fuera de la zona de previsión del DMI',
    failed: 'sin respuesta del DMI',
    to: 'a',
    in: 'en',
    precipitationMm: 'mm de precipitación',
    gustsUpTo: 'rachas de hasta',
  },
};

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** "Thu 2", "jeu. 2"... for a 'YYYY-MM-DD' date. */
export function dayLabel(date, language) {
  // Noon UTC: the same calendar day in every time zone.
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "14:00" in the time zone of Gladys. */
export function timeLabel(date, language, timeZone) {
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
}
