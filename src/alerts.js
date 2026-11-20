// -----------------------------------------------------------------------------
// Forecast alerts, the scene trigger `forecast_alert`: frost, storm gusts and
// heavy rain expected within the next 24 hours of the DMI forecast.
//
// The thresholds follow the DMI vocabulary: frost below 0 °C, gusts of
// 24.5 m/s ("storm" on the Beaufort scale used by DMI warnings), and heavy
// rain of 24 mm or more within 6 hours ("kraftig regn"). Scene filters only
// compare for equality: the thresholds live here, not in the scene.
//
// When an alert is announced again is the hub's business (src/hub.js).
// -----------------------------------------------------------------------------

import { hourlySteps } from './dmi/forecast.js';

export const ALERT_KINDS = ['frost', 'storm', 'heavy_rain'];
export const FROST_BELOW_C = 0;
export const STORM_GUST_MS = 24.5;
export const HEAVY_RAIN_MM = 24;
const HEAVY_RAIN_HOURS = 6;
const HORIZON_HOURS = 24;

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * @param {{ steps: object[] } | null} forecast
 * @param {Date} now
 * @returns {{ kind: string, value: number, startsAt: string }[]}
 */
export function forecastAlerts(forecast, now) {
  if (!forecast) {
    return [];
  }
  const steps = hourlySteps(forecast, now, HORIZON_HOURS);
  const alerts = [];
  const add = (kind, step, value) =>
    alerts.push({
      kind,
      value: round1(value),
      startsAt: step.time.toISOString(),
    });

  const frost = steps.find((step) => step.temperature !== null && step.temperature < FROST_BELOW_C);
  if (frost) {
    add('frost', frost, Math.min(...steps.map((s) => s.temperature).filter((t) => t !== null)));
  }
  const storm = steps.find((step) => step.windGust !== null && step.windGust >= STORM_GUST_MS);
  if (storm) {
    add('storm', storm, Math.max(...steps.map((s) => s.windGust).filter((g) => g !== null)));
  }
  // The first hour a 6-hour total reaches the threshold dates the alert; the
  // value is the wettest total.
  let first = null;
  let wettest = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const window = steps.slice(Math.max(0, index - HEAVY_RAIN_HOURS + 1), index + 1);
    const sum = window.reduce((total, step) => total + (step.precipitation ?? 0), 0);
    if (sum >= HEAVY_RAIN_MM) {
      first ??= steps[index];
      wettest = Math.max(wettest, sum);
    }
  }
  if (first) {
    add('heavy_rain', first, wettest);
  }
  return alerts;
}
