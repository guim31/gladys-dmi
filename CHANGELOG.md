# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: the official weather of the Danish Meteorological Institute
  (DMI) in Gladys, for Denmark, Greenland and the Faroe Islands, from the DMI
  open data (no account, no key).
- A forecast device per place (Gladys houses, typed coordinates): the hour in
  progress, the low, high and precipitation of today and tomorrow (HARMONIE
  DINI, HARMONIE IG for Greenland).
- A station device per DMI station used: the measurements of the nearest
  station (or a chosen one), every 10 minutes, with only what it measures.
- The "DMI forecast alert" scene trigger: frost, storm gusts, heavy rain
  within 24 hours.
- The "Read the DMI forecast" and "Read the DMI station" scene actions.
- The "DMI weather" dashboard widget.
- The "Check DMI" configuration action.
- Texts and documentation in English, French, German and Spanish.
