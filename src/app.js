// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the hub, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { LANGUAGES, normalizeConfig } from './config.js';
import { currentStep } from './dmi/forecast.js';
import { ActionFailure } from './errors.js';
import { DmiHub, WIDGET_KEY } from './hub.js';
import { CONDITIONS, STATUS, TEXT, pick } from './i18n.js';
import { createSceneActions } from './scenes.js';
import { Store } from './store.js';
import { createWidgets } from './widgets.js';

const logger = createLogger({ name: 'dmi-app' });

/**
 * The report of the "Check" action, in the four languages: per place, the
 * station and its temperature, then the forecast of the hour.
 * @param {Awaited<ReturnType<DmiHub['check']>>} results
 * @param {Date} now
 * @returns {{ ok: boolean, message: Record<string, string> }}
 */
export function checkReport(results, now) {
  const message = {};
  let ok = false;
  for (const language of LANGUAGES) {
    const text = pick(TEXT, language);
    message[language] = results
      .map(({ place, forecast, error, station, distance, observations }) => {
        const parts = [];
        if (station) {
          const temperature = observations?.values.temp_dry?.value;
          parts.push(
            `${text.station} ${station.name} (${distance} km)` +
              (temperature === undefined
                ? ''
                : ` ${Math.round(temperature * 10) / 10} °C ${text.observed}`),
          );
          ok ||= observations !== null;
        } else {
          parts.push(text.noStation);
        }
        const step = forecast ? currentStep(forecast, now) : null;
        if (step) {
          ok = true;
          parts.push(
            `${text.forecast} ${step.temperature} °C, ${pick(CONDITIONS, language)[step.condition] ?? ''}`.trim(),
          );
        } else {
          parts.push(error?.outOfArea ? text.outside : text.failed);
        }
        return `${place.name}: ${parts.join(', ')}.`;
      })
      .join(' ');
  }
  return { ok, message };
}

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, client, timers, now, timeZone
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new DmiHub({
    gladys,
    store: options.store ?? new Store(),
    client: options.client,
    timers: options.timers ?? true,
    now: options.now,
    timeZone: options.timeZone,
  });

  // Resolved once the hub has started: a command arriving during the first
  // refresh waits for it.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): the houses may have moved, and
        // Gladys may have lost what was sent.
        await hub.reconfigure(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, STATUS.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.on('disconnected', () => hub.stop());

  gladys.onScanRequest(
    whenReady(async () => hub.reconfigure(normalizeConfig(await gladys.getConfig()))),
  );

  // Read-only devices: nothing to command.
  gladys.onSetValue(async (device) => {
    throw new Error(`${device.external_id} is read-only`);
  });

  gladys.onPoll(whenReady((device) => hub.poll(device)));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  // A renamed device: the widget shows the name given in Gladys.
  gladys.onDeviceUpdated(whenReady(async () => gladys.requestWidgetRefresh(WIDGET_KEY)));
  gladys.onDeviceDeleted(whenReady(async () => gladys.requestWidgetRefresh(WIDGET_KEY)));

  gladys.onConfigUpdated(
    whenReady(async (raw) => {
      logger.info('New configuration');
      await hub.reconfigure(normalizeConfig(raw));
      gladys.requestWidgetRefresh(WIDGET_KEY);
    }),
  );

  gladys.onAction(
    'check',
    whenReady(async () => {
      logger.info('Action: check DMI');
      if (hub.places.length === 0) {
        throw new ActionFailure(
          hub.config?.coordinatesInvalid ? STATUS.invalidCoordinates : STATUS.noPlace,
        );
      }
      const { ok, message } = checkReport(await hub.check(), new Date(hub.now()));
      if (!ok) {
        throw new ActionFailure(message);
      }
      return message;
    }),
  );

  for (const [key, handler] of Object.entries(createSceneActions(hub))) {
    gladys.onSceneAction(key, whenReady(handler));
  }

  for (const [key, widget] of Object.entries(createWidgets(hub))) {
    gladys.onWidgetGet(key, whenReady(widget.get));
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
