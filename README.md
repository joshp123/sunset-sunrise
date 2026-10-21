# Sunset and sunrise

A map of sunset and sunrise times anywhere in the world, on any day of the year, by each place's own clock. Live at <https://sunsetsunrise.jjpcodes.com>.

Pick a place and a day, play the year, jump to the shortest and longest days and the clock changes, and see what would happen if the clocks stopped changing. Every view has its own link, and Share makes a picture of it.

## How it works

Everything is worked out in the browser from first principles; there are no tables of sunset times.

- **The sun:** NOAA's solar position equations (after Meeus) give sunrise and sunset for every pixel of the map, on the graphics card, as the moment the top of the sun meets a flat horizon. They agree with the US Naval Observatory to the minute.
- **The clocks:** the browser's own IANA time zone database gives each zone's offset on each day. Time zone boundaries come from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder), rasterised to 0.1°. Zone names are the database's own abbreviations, or the offset where it has none.
- **The colours:** Ryan Hall's sky, from night to day, spaced so each step looks equally different. Darker means a darker evening (or morning). The key belongs to the date: it spans the world's cities' times that day and is at least 3.5 hours wide, so everyone looking at the same day sees the same colours.
- **The places:** GeoNames places of 15,000 people or more; the larger ones are labelled, chosen once for each zoom level so panning never moves them.

## Run locally

```sh
python3 -m http.server 5207
```

Then open <http://127.0.0.1:5207/>. Add `&card=post` or `&card=link` to any view's address to see its share picture full size.

## Deploy

The public ChatGPT Site is identified by `.openai/hosting.json`. Its Worker serves the app, local libraries and data, IP-based `/api/home`, and link preview metadata. DNS is managed in `opentofu-infra/websites/jjpcodes.com/sunset-sunrise-sites.tf`.

From a Node.js 24 environment, commit the source changes, then run:

```sh
node hosting/build.mjs
node ~/.codex/plugins/cache/openai-curated-remote/sites/1.1.0/scripts/site-workflow.mjs --project-id appgprj_6ad7ddad964c8191a8fe2df7b564c651
```

Obtain a fresh credential with Sites `create_source_repository_write_credential`. At the helper's hidden stdin prompt, send `{"credential": <returned credential object>, "commands": [], "archivePath": "/tmp/sunset-sunrise-sites.tar.gz"}`. Keep the credential out of files and shell arguments. Pass the helper's exact `project_id`, `commit_sha` and `archive` to Sites `save_site_version`, then its returned version ID to `deploy_site_version`. Preserve the public audience. Finally run `git push origin main`.

To rebuild and upload a monthly IP location table, run `python3 tools/publish-ip-location.py --month 2026-10 --file /path/to/dbip-city-lite-2026-10.csv.gz --site https://sunsetsunrise.jjpcodes.com`. Omit `--file` to download that month's release. The script prompts for the Site's `IP_LOCATION_PUBLISH_TOKEN` secret (or reads it from the environment); configure a matching secret through Sites runtime environment settings and deploy before the first upload. It publishes the index and complete range table to the Site's R2 storage, then switches the current release atomically. Lookups read one chunk of at most 51,200 bytes, with a cached index. `hosting/storage.json` declares the storage binding included by the build.

## Rebuild the data

```sh
uv run --with pillow --with numpy python -I tools/build_data.py <timezones-with-oceans.json> <cities15000.txt> data
uv run --with tzdata python -I tools/zone_names.py data/zones.json data/zone-names.json
```

The first input is from timezone-boundary-builder's release `timezones-with-oceans.geojson.zip`, the second from GeoNames' `cities15000.zip`.

## Sources and licences

The code is under the MIT licence (see `LICENSE`). The data keeps its sources' licences:

- Time zone boundaries: timezone-boundary-builder, from OpenStreetMap data, © OpenStreetMap contributors, ODbL.
- Time zones and their names: the IANA time zone database, public domain.
- Places: GeoNames, CC BY 4.0. Place names for Palestine follow `tools/palestine-places.mjs`.
- Land and borders: Natural Earth via world-atlas, public domain.
- IP location by DB-IP ([db-ip.com](https://db-ip.com)), CC BY 4.0.

Inspired by Ryan Hall's sunset maps. Built alongside [Nice Weather](https://nice.jjpcodes.com).
