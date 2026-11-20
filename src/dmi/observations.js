// -----------------------------------------------------------------------------
// DMI station observations (metObs v2, `observation` collection): one GeoJSON
// feature per parameter and per instant, every 10 minutes (hourly for some
// parameters and stations). Only the latest value of each parameter is kept.
// -----------------------------------------------------------------------------

/**
 * @param {any} json GeoJSON FeatureCollection
 * @returns {{ observedAt: Date | null, values: Record<string, { value: number, observed: Date }> }}
 * @throws when the body is not a collection
 */
export function parseObservations(json) {
  if (!json || !Array.isArray(json.features)) {
    throw new Error('the answer holds no observation');
  }
  const values = {};
  let observedAt = null;
  for (const feature of json.features) {
    const { parameterId, value, observed } = feature?.properties ?? {};
    const time = new Date(observed);
    if (
      typeof parameterId !== 'string' ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      Number.isNaN(time.getTime())
    ) {
      continue;
    }
    if (!values[parameterId] || values[parameterId].observed < time) {
      values[parameterId] = { value, observed: time };
    }
    if (!observedAt || observedAt < time) {
      observedAt = time;
    }
  }
  return { observedAt, values };
}
