# DMI for Gladys Assistant

The official weather of the **Danish Meteorological Institute (DMI)** in
[Gladys Assistant](https://gladysassistant.com): what the nearest DMI weather
station measures, and the DMI HARMONIE forecast of your place, in Denmark,
Greenland and the Faroe Islands. DMI open data: no account, no API key (DMI
dropped the keys in December 2025).

> Not affiliated with DMI. Tested against the live DMI API, not yet in a real
> Gladys installation: feedback welcome.

## What it does

- **One forecast device per place** (each Gladys house with a location, plus
  optional typed coordinates): the hour in progress (temperature, humidity,
  pressure, wind, gusts, direction, cloud cover, precipitation, weather in
  words) and the low, high and precipitation of today and tomorrow.
- **One station device per DMI station used**: the nearest station measuring
  temperature and wind (or the one you choose), every 10 minutes, with only
  the features that station measures.
- **DMI forecast alert** scene trigger: frost, storm gusts (24.5 m/s) or heavy
  rain (24 mm in 6 h) within 24 hours, when it appears (a reminder a day later if it lasts).
- **Read the DMI forecast** and **Read the DMI station** scene actions.
- **DMI weather** dashboard widget: measured weather, 24-hour chart, three
  days (chart and days can be hidden).
- **Check DMI** configuration action.
- Every text in English, French, German and Spanish.

Unlike MET Norway (worldwide forecast, no measurements) and MeteoAlarm
(official warnings), this integration gives the DMI station measurements and
the DMI model.

## Requirements

- Gladys Assistant **5.3.0** or later.
- Outbound HTTPS to `opendataapi.dmi.dk`.
- A location on a Gladys house (Settings → Houses), or coordinates typed in
  the configuration.

## Installation

In Gladys: **Integrations → Install from GitHub**, then
`https://github.com/guim31/gladys-dmi` (or install **DMI** from the store).
Accept the access to the house locations, then add the devices from the
**Discovery** tab.

The user documentation, in four languages: [English](./docs/en.md),
[Français](./docs/fr.md), [Deutsch](./docs/de.md), [Español](./docs/es.md).

## How it works

- Observations: `GET /v2/metObs/collections/observation/items?stationId=…&period=latest-hour`;
  stations: `/v2/metObs/collections/station/items?status=Active&datetime=…`.
- Forecast: the EDR `position` query of `harmonie_dini_sf` (Denmark, Faroe
  Islands, Iceland, North Sea), then `harmonie_ig_sf` (Greenland). A point
  outside a model grid gets the edge cell, hundreds of kilometres away: the
  integration checks the distance of the cell (10 km at most).
- DMI answers 429 "Server is busy" to bursts: one request at a time, spaced
  by a second, retried after 5 and 15 s. Per refresh (10 min by default): one
  request per added station; each added place's forecast at most once an
  hour; the station list once a day.

## Limits

- The weather in words is derived (cloud cover, precipitation, temperature):
  HARMONIE has no weather symbol.
- About 60 hours of forecast (72 in Greenland).
- The DMI warnings are not part of the open data.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against answers recorded from the DMI API in `test/fixtures/dmi/`.

## Credits

- Data: **Danish Meteorological Institute (DMI)**, open data under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Logo: the DMI crown, from [dmi.dk](https://www.dmi.dk/), used to identify the
  service on the store cover.
- Template: [GladysAssistant/integration-template-js](https://github.com/GladysAssistant/integration-template-js).

## Licence

Apache-2.0, see [LICENSE](./LICENSE).
