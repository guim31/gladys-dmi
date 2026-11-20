// -----------------------------------------------------------------------------
// DMI HARMONIE forecast of a point (EDR `position` query, CoverageJSON):
// parsing and the views built on it.
//
// The answer holds one time axis (hourly, from the model run, about 60 hours
// for DINI and 72 for IG), the grid cell actually used (x, y) and one array
// of values per parameter, in SI units: kelvin, pascal, fraction 0..1.
// `total-precipitation` is accumulated since the start of the run: the
// amount of an hour is the difference with the previous step (a slightly
// negative difference is rounding noise of the model, read as 0).
// -----------------------------------------------------------------------------

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value, digits = 1) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * A simple weather condition, as HARMONIE gives no weather symbol: from the
 * precipitation of the hour, the temperature and the cloud cover.
 * @returns {'clear' | 'partly_cloudy' | 'cloudy' | 'light_rain' | 'rain' | 'snow' | null}
 */
export function conditionOf({ precipitation, temperature, cloudCover }) {
  if (precipitation !== null && precipitation >= 0.1) {
    if (temperature !== null && temperature <= 0) {
      return 'snow';
    }
    return precipitation >= 2 ? 'rain' : 'light_rain';
  }
  if (cloudCover === null) {
    return null;
  }
  if (cloudCover < 25) {
    return 'clear';
  }
  return cloudCover < 75 ? 'partly_cloudy' : 'cloudy';
}

/**
 * @param {any} json CoverageJSON body
 * @returns {{ latitude: number, longitude: number, steps: object[] }}
 * @throws when the body is not a forecast
 */
export function parseForecast(json) {
  const times = json?.domain?.axes?.t?.values;
  const x = num(json?.domain?.axes?.x?.values?.[0]);
  const y = num(json?.domain?.axes?.y?.values?.[0]);
  if (!Array.isArray(times) || times.length === 0 || x === null || y === null || !json.ranges) {
    throw new Error('the answer holds no forecast');
  }
  const series = (name) => json.ranges[name]?.values ?? [];
  const at = (name, index) => num(series(name)[index]);
  const steps = [];
  let previousTotal = null;
  times.forEach((value, index) => {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) {
      return;
    }
    const kelvin = at('temperature-2m', index);
    const pascal = at('pressure-sealevel', index);
    const fraction = at('fraction-of-cloud-cover', index);
    const total = at('total-precipitation', index);
    let precipitation = null;
    if (total !== null) {
      precipitation = round(Math.max(previousTotal === null ? total : total - previousTotal, 0));
      previousTotal = total;
    }
    const step = {
      time,
      temperature: kelvin === null ? null : round(kelvin - 273.15),
      humidity: round(at('relative-humidity-2m', index), 0),
      pressure: pascal === null ? null : round(pascal / 100),
      windSpeed: round(at('wind-speed-10m', index)),
      windGust: round(at('gust-wind-speed-10m', index)),
      windDirection: round(at('wind-dir-10m', index), 0),
      cloudCover: fraction === null ? null : Math.round(Math.min(Math.max(fraction, 0), 1) * 100),
      // mm fallen during the hour ending at `time`.
      precipitation,
    };
    if (step.humidity !== null) {
      step.humidity = Math.min(Math.max(step.humidity, 0), 100);
    }
    if (step.windDirection !== null) {
      step.windDirection %= 360;
    }
    step.condition = conditionOf(step);
    steps.push(step);
  });
  if (steps.length === 0) {
    throw new Error('the answer holds no forecast');
  }
  steps.sort((a, b) => a.time - b.time);
  return { latitude: y, longitude: x, steps };
}

/**
 * The step describing "now": the hour in progress (the first step ending
 * after now), the first step when the forecast starts later.
 * @returns {object | null} null once the forecast is entirely in the past
 */
export function currentStep(forecast, now = new Date()) {
  const at = now.getTime();
  return forecast.steps.find((step) => step.time.getTime() >= at) ?? null;
}

/** The hourly steps from the current one, at most `count`. */
export function hourlySteps(forecast, now = new Date(), count = 24) {
  const first = currentStep(forecast, now);
  if (!first) {
    return [];
  }
  const from = forecast.steps.indexOf(first);
  return forecast.steps.slice(from, from + count);
}

/** The calendar date of an instant in a time zone, 'YYYY-MM-DD'. */
export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 'YYYY-MM-DD' plus `days` calendar days (no 24-hour step: DST-proof). */
export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localHour(date, timeZone) {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date),
  );
}

const known = (values) => values.filter((value) => value !== null);
const maxOf = (values) => (known(values).length > 0 ? Math.max(...known(values)) : null);
const minOf = (values) => (known(values).length > 0 ? Math.min(...known(values)) : null);

/**
 * One summary per local day, from today on. `hours` counts the forecast
 * hours of the day: the first and the last day of the run are often partial.
 * @returns {{ date: string, hours: number, temperatureMin, temperatureMax, precipitation,
 *   windSpeedMax, windGustMax, condition }[]}
 */
export function dailySummaries(forecast, now = new Date(), timeZone = undefined) {
  const first = currentStep(forecast, now);
  if (!first) {
    return [];
  }
  // Today counts every hour of the run since local midnight (the run starts
  // a few hours before now), not only the hours to come.
  const today = localDate(now, timeZone);
  const days = new Map();
  for (const step of forecast.steps) {
    const date = localDate(step.time, timeZone);
    if (date < today) {
      continue;
    }
    if (!days.has(date)) {
      days.set(date, []);
    }
    days.get(date).push(step);
  }
  return [...days].map(([date, steps]) => {
    const amounts = known(steps.map((step) => step.precipitation));
    const total = amounts.length > 0 ? round(amounts.reduce((sum, value) => sum + value, 0)) : null;
    // The weather of the day: rain or snow when the day brings 1 mm or more,
    // otherwise the sky of early afternoon (or of the last hour left).
    const midday = steps.find((step) => localHour(step.time, timeZone) >= 13) ?? steps.at(-1);
    let condition = midday.condition;
    if (total !== null && total >= 1) {
      const temperatureMax = maxOf(steps.map((step) => step.temperature));
      condition =
        temperatureMax !== null && temperatureMax <= 0
          ? 'snow'
          : total >= 10
            ? 'rain'
            : 'light_rain';
    }
    return {
      date,
      hours: steps.length,
      temperatureMin: minOf(steps.map((step) => step.temperature)),
      temperatureMax: maxOf(steps.map((step) => step.temperature)),
      precipitation: total,
      windSpeedMax: maxOf(steps.map((step) => step.windSpeed)),
      windGustMax: maxOf(steps.map((step) => step.windGust)),
      condition,
    };
  });
}
