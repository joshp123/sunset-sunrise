---
written_by: AI (Claude Opus 5.5), 2026-10-21, from Josh's steering
---

# AGENTS.md

Josh owns this project. His own words are the authority. They are kept privately, outside this public repository, in `.agent/` on his machine (ignored by Git); never commit or publish them. Everything else here, including this file, is secondary.

## What it is

A map of sunset and sunrise times for the whole world, any day of the year, by each place's own clock, in the spirit of Ryan Hall's "find your sunset the day clocks fall back" poster and in Nice Weather's style. Live at <https://sunsetsunrise.jjpcodes.com> (ChatGPT Sites).

## How it is built

- `index.html` is the whole app: the sun maths, the clocks, the WebGL map, labels, the year strip, sharing.
- `data/` holds the 0.1° time zone raster (`zones.png`, two bytes per cell index into `zones.json`), each zone's abbreviations (`zone-names.json`) and the places (`cities.json`). `tools/` rebuilds them.
- The server (Sites Worker) serves the app and data, answers `/api/home` with the visitor's rough location from the request's own IP lookup, and gives each link its own preview.

## Decisions Josh made

- Colours: Ryan Hall's sky, evenly spaced; the key is set by the date (world's cities, 1st to 99th percentile, at least 3.5 hours wide). A screenshot depends only on the date, sunset or sunrise, the clock rule and the view, never on who takes it.
- Place names, borders and search in the Levant follow Nice Weather (`tools/palestine-places.mjs`). No country labels.
- The default place for Dutch time is Rotterdam, as in Nice Weather.
- Opus builds the frontend; GPT-6.1 Sol may build the backend and deployment, never frontend or UI.

## Check your own work

Test what Josh would see: open the page in WebKit (Safari's engine) at phone (390 × 844), laptop (1512 × 900) and wide sizes, light and dark; pan, zoom, scrub the year, switch sunrise and the clock rules, open the calendar and Share; look at the screenshots. Pans, zooms and day changes must redraw within one frame. Spot-check times against the US Naval Observatory (`https://aa.usno.navy.mil/api/rstt/oneday`).
