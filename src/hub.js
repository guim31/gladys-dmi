// -----------------------------------------------------------------------------
// The DMI hub: the places and their stations, the forecasts and observations,
// the container's own refresh timer, the states, the scene trigger and the
// connection status.
//
// Refresh. The devices are published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll: a device
// created without these fields is never polled, even once the core is fixed
// (GladysAssistant/Gladys#3198). So the container refreshes by itself, every
// `refresh_minutes`, and the core's onPoll is a fallback that only reads DMI
// when the timer has not done it for 1.2 periods. Only the devices the user
// added are read: Gladys drops the states of a device it does not know.
//
// Quotas. DMI publishes no quota for its keyless open data, but answers 429
// to bursts: the client serializes and spaces the requests. Per period: one
// request per added station (DMI measures every 10 minutes); the forecast of
// an added place at most once an hour (the model runs every three hours);
// the station list once a day.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ALERT_KINDS, forecastAlerts } from './alerts.js';
import {
  PLACE_TYPE,
  STATION_TYPE,
  buildPlaceDevice,
  buildPlaceStates,
  buildStationDevice,
  buildStationStates,
} from './devices.js';
import { createClient } from './dmi/client.js';
import { stationFor } from './dmi/stations.js';
import { STATUS } from './i18n.js';
import { createIssueLog } from './issues.js';
import { resolvePlaces } from './places.js';

const logger = createLogger({ name: 'dmi' });

export const WIDGET_KEY = 'weather';
export const TRIGGER_KEY = 'forecast_alert';
// An unchanged value is sent again at least this often: Gladys shows "no
// recent value" after 48 h, and the heartbeat must stay under 12 h.
export const STATE_HEARTBEAT_MS = 6 * 3_600_000;
export const FORECAST_PERIOD_MS = 60 * 60_000;
export const STATIONS_PERIOD_MS = 24 * 3_600_000;
// An alert still in the forecast is announced again after this.
export const ALERT_REMINDER_MS = 24 * 3_600_000;
// A forecast older than this is not used any more.
const MAX_FORECAST_AGE_MS = 12 * 3_600_000;

export class DmiHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {import('./store.js').Store} options.store
   * @param {ReturnType<typeof createClient>} [options.client]
   * @param {boolean} [options.timers] run the refresh timer (tests may turn it off)
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] default: TZ, set by the Gladys supervisor
   */
  constructor({ gladys, store, client, timers = true, now, timeZone }) {
    this.gladys = gladys;
    this.store = store;
    this.client = client ?? createClient();
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.timeZone = timeZone ?? (process.env.TZ || undefined);
    this.issues = createIssueLog(logger);
    this.config = null;
    this.places = [];
    /** null until the station list was read once. */
    this.stations = null;
    this.stationsAttemptedAt = undefined;
    this.stationsFetchedAt = undefined;
    /** platformId → { station, distance } | null */
    this.placeStations = new Map();
    /** platformId → { forecast, fetchedAt, attemptedAt, error } */
    this.forecasts = new Map();
    /** station id → { observations, fetchedAt, attemptedAt, error } */
    this.observations = new Map();
    this.announced = {};
    this.timer = null;
    this.stopped = false;
    this.running = null;
    this.lastStatus = null;
    this.lastDevices = null;
  }

  get periodMs() {
    return (this.config?.refresh_minutes ?? 10) * 60_000;
  }

  /** First start: what was announced, the places, the devices, a first refresh. */
  async start(config) {
    this.announced = (await this.store.load()).announced;
    await this.reconfigure(config);
  }

  /** New configuration, or a reconnection: Gladys may have lost what we sent. */
  async reconfigure(config) {
    this.config = config;
    this.stopped = false;
    // Gladys may have restarted: the status is sent again.
    this.lastStatus = null;
    if (config.coordinatesInvalid) {
      logger.warn('The coordinates of the configuration cannot be read: they are ignored');
    }
    if (config.stationInvalid) {
      logger.warn('The station of the configuration is not a DMI station id: ignored');
    }
    const houses = await this.readHouses();
    const before = this.places.map((place) => place.platformId).join(',');
    this.places = resolvePlaces(config, houses);
    if (this.places.map((place) => place.platformId).join(',') !== before) {
      logger.info(
        this.places.length > 0
          ? `Following ${this.places.length} place(s): ${this.places.map((p) => p.name).join(', ')}`
          : 'No place to follow: no located house, no coordinates',
      );
    }
    for (const platformId of this.forecasts.keys()) {
      if (!this.places.some((place) => place.platformId === platformId)) {
        this.forecasts.delete(platformId);
      }
    }
    if (this.places.length > 0 && !this.stations) {
      await this.readStations();
    }
    this.assignStations();
    this.lastDevices = null;
    await this.publishDevices();
    this.gladys.forgetPublishedStates?.();
    this.schedule();
    await this.refresh({ force: true });
  }

  async readHouses() {
    if (!this.config.use_houses) {
      return [];
    }
    try {
      const houses = await this.gladys.getHouses();
      this.issues.ok('houses', 'The houses of Gladys can be read again');
      return houses;
    } catch (err) {
      this.issues.fail('houses', `Cannot read the houses of Gladys (${err.message})`);
      return [];
    }
  }

  async readStations() {
    this.stationsAttemptedAt = this.now();
    try {
      this.stations = await this.client.stations(new Date(this.now()));
      this.stationsFetchedAt = this.now();
      logger.debug(`${this.stations.length} DMI weather stations`);
      this.issues.ok('stations', 'The DMI station list is back');
    } catch (err) {
      this.issues.fail('stations', `DMI station list unavailable (${err.message})`);
    }
  }

  /** The station of each place: the one configured, or the nearest. */
  assignStations() {
    this.placeStations.clear();
    for (const place of this.places) {
      const found = this.stations
        ? stationFor(this.stations, place, {
            stationId: this.config.station,
            maxKm: this.config.station_max_km,
          })
        : null;
      this.placeStations.set(place.platformId, found);
    }
  }

  /** The distinct stations of the places. */
  usedStations() {
    const stations = new Map();
    for (const entry of this.placeStations.values()) {
      if (entry) {
        stations.set(entry.station.id, entry.station);
      }
    }
    return [...stations.values()];
  }

  devices() {
    const language = this.config.language;
    return [
      ...this.places.map((place) => buildPlaceDevice(this.gladys, place, language)),
      ...this.usedStations().map((station) => buildStationDevice(this.gladys, station, language)),
    ];
  }

  /** Publish the discovered devices, when they changed. */
  async publishDevices() {
    const devices = this.devices();
    const key = JSON.stringify(devices);
    if (key === this.lastDevices) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.lastDevices = key;
      this.issues.ok('discovery', 'Gladys accepts the discovered devices again');
    } catch (err) {
      this.issues.fail('discovery', `Gladys refused the discovered devices (${err.message})`);
    }
  }

  placeId(place) {
    return this.gladys.externalIds(PLACE_TYPE, place.platformId).device;
  }

  stationId(station) {
    return this.gladys.externalIds(STATION_TYPE, station.id).device;
  }

  placeByDevice(externalId) {
    return this.places.find((place) => this.placeId(place) === externalId) ?? null;
  }

  stationByDevice(externalId) {
    return this.usedStations().find((station) => this.stationId(station) === externalId) ?? null;
  }

  stationOf(place) {
    return this.placeStations.get(place.platformId) ?? null;
  }

  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** The places and stations whose device the user added to Gladys. */
  createdPlaces() {
    const created = this.createdIds();
    return this.places.filter((place) => created.has(this.placeId(place)));
  }

  createdStations() {
    const created = this.createdIds();
    return this.usedStations().filter((station) => created.has(this.stationId(station)));
  }

  /** The device name the user gave in Gladys, else the published one. */
  deviceName(externalId, fallback) {
    return (
      (this.gladys.devices ?? []).find((device) => device.external_id === externalId)?.name ??
      fallback
    );
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timers || this.stopped) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.refresh();
      } catch (err) {
        logger.error(`Refresh failed (${err.message})`);
      } finally {
        this.schedule();
      }
    }, this.periodMs);
    this.timer.unref?.();
  }

  /**
   * One refresh; one at a time, a caller arriving during a refresh waits for
   * it then runs its own when forced.
   * @param {{ force?: boolean, places?: object[], stations?: object[], minGap?: number }} [options]
   */
  async refresh(options = {}) {
    while (this.running) {
      await this.running.catch(() => {});
      // The timer's refresh just ended: it did the work. A caller with its
      // own targets (a device just added, a scene action) runs its own.
      if (!options.force && !options.places && !options.stations) {
        return;
      }
    }
    this.running = this.doRefresh(options);
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  async doRefresh({ force = false, places, stations, minGap = 0.5 } = {}) {
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: refresh skipped');
      return;
    }
    const now = this.now();
    const due = (attemptedAt, period) =>
      force || attemptedAt === undefined || now - attemptedAt >= period * minGap;

    // The station list, once a day (or until it could be read once).
    if (
      this.places.length > 0 &&
      (this.stations
        ? now - this.stationsFetchedAt >= STATIONS_PERIOD_MS &&
          now - this.stationsAttemptedAt >= FORECAST_PERIOD_MS
        : due(this.stationsAttemptedAt, this.periodMs))
    ) {
      await this.readStations();
      this.assignStations();
      await this.publishDevices();
    }

    const placeTargets = places ?? this.createdPlaces();
    const stationTargets =
      stations ??
      (places
        ? places.map((place) => this.stationOf(place)?.station).filter(Boolean)
        : this.createdStations());
    // The forecast: once an hour, read by the first timer tick past the hour
    // (half a period of slack), or by the onPoll fallback.
    const forecastDue = (attemptedAt) =>
      force ||
      attemptedAt === undefined ||
      now - attemptedAt >= Math.max(FORECAST_PERIOD_MS, this.periodMs * minGap) - this.periodMs / 2;
    for (const place of placeTargets) {
      if (forecastDue(this.forecasts.get(place.platformId)?.attemptedAt)) {
        await this.readForecast(place);
      }
    }
    for (const station of new Set(stationTargets)) {
      if (due(this.observations.get(station.id)?.attemptedAt, this.periodMs)) {
        await this.readObservations(station);
      }
    }

    // The "check" action reads devices the user has not added: no states for them.
    const createdPlaces = this.createdPlaces();
    const createdStations = this.createdStations();
    await this.publishStates(
      placeTargets.filter((place) => createdPlaces.includes(place)),
      [...new Set(stationTargets)].filter((station) => createdStations.includes(station)),
    );
    await this.announceAlerts(placeTargets.filter((place) => createdPlaces.includes(place)));
    await this.updateStatus();
  }

  async readForecast(place) {
    const entry = this.forecasts.get(place.platformId) ?? {};
    entry.attemptedAt = this.now();
    this.forecasts.set(place.platformId, entry);
    try {
      entry.forecast = await this.client.forecast(place.latitude, place.longitude);
      entry.fetchedAt = this.now();
      entry.error = null;
      logger.debug(`${place.name}: forecast read (${entry.forecast.model})`);
      this.issues.ok(`forecast:${place.platformId}`, `${place.name}: the forecast is back`);
    } catch (err) {
      entry.error = err;
      this.issues.fail(
        `forecast:${place.platformId}`,
        `${place.name}: forecast unavailable (${err.message})`,
      );
    }
  }

  async readObservations(station) {
    const entry = this.observations.get(station.id) ?? {};
    entry.attemptedAt = this.now();
    this.observations.set(station.id, entry);
    try {
      entry.observations = await this.client.observations(station.id);
      entry.fetchedAt = this.now();
      entry.error = null;
      logger.debug(`${station.name}: observations read`);
      this.issues.ok(`station:${station.id}`, `${station.name}: the observations are back`);
    } catch (err) {
      entry.error = err;
      this.issues.fail(
        `station:${station.id}`,
        `${station.name}: observations unavailable (${err.message})`,
      );
    }
  }

  /** The forecast of a place, unless too old. */
  forecastOf(place) {
    const entry = this.forecasts.get(place.platformId);
    if (!entry?.forecast || this.now() - entry.fetchedAt > MAX_FORECAST_AGE_MS) {
      return null;
    }
    return entry.forecast;
  }

  observationsOf(station) {
    return this.observations.get(station.id)?.observations ?? null;
  }

  async publishStates(places, stations) {
    const now = new Date(this.now());
    const options = { language: this.config.language, now, timeZone: this.timeZone };
    const states = [
      ...places.flatMap((place) =>
        buildPlaceStates(this.gladys, place, this.forecastOf(place), options),
      ),
      ...stations.flatMap((station) =>
        buildStationStates(this.gladys, station, this.observationsOf(station), now),
      ),
    ];
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: STATE_HEARTBEAT_MS,
      });
      this.issues.ok('states', 'Gladys accepts the states again');
      if (count > 0) {
        logger.debug(`${count} state(s) published`);
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      }
    } catch (err) {
      // Not remembered by the SDK: sent again by the next refresh.
      this.issues.fail('states', `Gladys refused the states (${err.message})`);
    }
  }

  /**
   * Fire the scene trigger when an alert starts: a kind absent from the
   * previous forecast, or still there a day after it was announced (a long
   * cold spell reminds once a day). A kind that disappears ends its episode.
   * Kept under /data, so a restart does not repeat an alert.
   */
  async announceAlerts(places) {
    const now = new Date(this.now());
    let changed = false;
    for (const place of places) {
      const forecast = this.forecastOf(place);
      if (!forecast) {
        continue;
      }
      const stored = this.announced[place.platformId];
      const previous = stored && !Array.isArray(stored) && typeof stored === 'object' ? stored : {};
      const next = {};
      for (const alert of forecastAlerts(forecast, now)) {
        const last = previous[alert.kind];
        if (typeof last === 'number' && now.getTime() - last < ALERT_REMINDER_MS) {
          next[alert.kind] = last;
          continue;
        }
        try {
          await this.gladys.publishSceneEvent(TRIGGER_KEY, {
            device: this.placeId(place),
            kind: alert.kind,
            value: alert.value,
            starts_at: alert.startsAt,
          });
          next[alert.kind] = now.getTime();
          logger.info(`${place.name}: ${alert.kind} expected (${alert.value}, ${alert.startsAt})`);
        } catch (err) {
          // Not remembered: announced again by the next refresh.
          logger.warn(`${place.name}: the alert could not reach the scenes (${err.message})`);
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(stored ?? {})) {
        this.announced[place.platformId] = next;
        changed = true;
      }
    }
    if (changed) {
      try {
        await this.store.save({ announced: this.announced });
        this.issues.ok('store', 'The state can be written to /data again');
      } catch (err) {
        this.issues.fail('store', `Cannot write to /data (${err.message})`);
      }
    }
  }

  /** The connection status of the Configuration screen, sent when it changes. */
  async updateStatus() {
    let status = { connected: true };
    if (this.places.length === 0) {
      status = {
        connected: false,
        message: this.config.coordinatesInvalid ? STATUS.invalidCoordinates : STATUS.noPlace,
      };
    } else if (
      this.config.station &&
      this.stations &&
      !this.stations.some((station) => station.id === this.config.station)
    ) {
      status = { connected: false, message: STATUS.unknownStation };
    } else {
      const attempted = [
        ...this.createdPlaces().map((place) => this.forecasts.get(place.platformId)),
        ...this.createdStations().map((station) => this.observations.get(station.id)),
      ].filter((entry) => entry?.attemptedAt !== undefined);
      if (attempted.length > 0 && attempted.every((entry) => entry.error)) {
        status = {
          connected: false,
          message: attempted.every((entry) => entry.error.outOfArea)
            ? STATUS.outOfArea
            : STATUS.unreachable,
        };
      }
    }
    const key = JSON.stringify(status);
    if (key === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.lastStatus = key;
    } catch (err) {
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  /** The core's onPoll: a fallback for when the timer stalls. */
  async poll(device) {
    const place = this.placeByDevice(device.external_id);
    const station = this.stationByDevice(device.external_id);
    if (!place && !station) {
      logger.debug(`onPoll ignored for ${device.external_id}`);
      return;
    }
    await this.refresh({
      places: place ? [place] : [],
      stations: station ? [station] : [],
      minGap: 1.2,
    });
  }

  /** A device was just added: Gladys has none of its states yet, send them all now. */
  async onDeviceCreated(device) {
    const place = this.placeByDevice(device.external_id);
    const station = this.stationByDevice(device.external_id);
    if (!place && !station) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    const places = place ? [place] : [];
    const stations = station ? [station] : [];
    // Read what was never read; the refresh then publishes everything it holds.
    await this.refresh({ places, stations, minGap: Infinity });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** "Check" action: read every place and its station now, added or not. */
  async check() {
    await this.refresh({ places: this.places, force: true });
    return this.places.map((place) => {
      const found = this.stationOf(place);
      return {
        place,
        forecast: this.forecastOf(place),
        error: this.forecasts.get(place.platformId)?.error ?? null,
        station: found?.station ?? null,
        distance: found?.distance ?? null,
        observations: found ? this.observationsOf(found.station) : null,
      };
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

export { ALERT_KINDS };
