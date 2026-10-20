"""Build the app's data: a 0.1-degree time-zone raster, the zone list and the place list.

Written by AI on 2026.10.20 by model claude opus 5.5.
Inputs: timezone-boundary-builder 2026e timezones-with-oceans GeoJSON (all IANA zones) and GeoNames cities15000.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

boundaries_path, cities_path, output_directory = map(Path, sys.argv[1:4])
cells_per_degree = 10
width, height = 360 * cells_per_degree, 180 * cells_per_degree

features = json.loads(boundaries_path.read_text())["features"]
zone_names = sorted({feature["properties"]["tzid"] for feature in features})
zone_index = {name: index + 1 for index, name in enumerate(zone_names)}

def ring_area(ring):
    xs, ys = np.asarray(ring).T
    return abs(np.dot(xs, np.roll(ys, 1)) - np.dot(ys, np.roll(xs, 1))) / 2

exterior_rings = []
for feature in features:
    geometry = feature["geometry"]
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    for polygon in polygons:
        exterior_rings.append((ring_area(polygon[0]), zone_index[feature["properties"]["tzid"]], polygon[0]))

# Largest first, so enclaves drawn later sit on top of the zone that surrounds them.
exterior_rings.sort(key=lambda ring: -ring[0])
raster = Image.new("I", (width, height), 0)
draw = ImageDraw.Draw(raster)
for _, index, ring in exterior_rings:
    points = [((lon + 180) * cells_per_degree, (90 - lat) * cells_per_degree) for lon, lat in ring]
    if len(points) >= 3:
        draw.polygon(points, fill=index)

indices = np.asarray(raster, dtype=np.uint32)
rgb = np.stack([(indices >> 8) & 255, indices & 255, np.zeros_like(indices)], axis=-1).astype(np.uint8)
Image.fromarray(rgb, "RGB").save(output_directory / "zones.png", optimize=True)
(output_directory / "zones.json").write_text(json.dumps(["none"] + zone_names))

# Neighbourhoods, historical and abandoned places are not places people look for.
skipped_feature_codes = {"PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"}
# Nice Weather's rule, from the same curated list: places in Palestine (GeoNames IL and PS) appear only under their
# Arabic names, Golan towns belong to Syria, and every other IL or PS entry is left out. Old names stay searchable.
import re
nice_weather_names = Path(__file__).with_name("palestine-places.mjs")  # the same curated list as Nice Weather
names_source = nice_weather_names.read_text(encoding="utf-8")
def curated(map_name):
    block = names_source.split(f"export const {map_name} = new Map([")[1].split("]);")[0]
    return {geonames_id: name for geonames_id, _, name in re.findall(r"\['(\d+)', (['\"])(.*?)\2\]", block)}
palestine_places, golan_places = curated("PALESTINE_PLACES"), curated("GOLAN_PLACES")
cities = []
for line in cities_path.read_text(encoding="utf-8").splitlines():
    fields = line.split("\t")
    if fields[7] in skipped_feature_codes:
        continue
    name, country, aliases = fields[1], fields[8], ""
    if country in ("IL", "PS"):
        geonames_id = fields[0]
        if geonames_id not in golan_places and geonames_id not in palestine_places:
            continue
        aliases = "|".join(sorted({fields[1], fields[2]} | ({"Tel Aviv", "Jaffa"} if geonames_id == "293397" else set())))
        name = golan_places.get(geonames_id) or palestine_places[geonames_id]
        country = "SY" if geonames_id in golan_places else "PS"
    population = int(fields[14] or 0)
    cities.append([name, round(float(fields[4]), 3), round(float(fields[5]), 3), population, fields[17], country, int(fields[7] == "PPLC"), aliases])
cities.sort(key=lambda city: -city[3])

# A map label goes to the biggest place in its neighbourhood: none within 30 km of a bigger labelled place.
import math
labelled_cells = {}
for city in cities:
    name, latitude, longitude, population = city[:4]
    labelable = population >= 100_000 or city[6]
    if labelable:
        cell = (round(latitude * 4), round(longitude * 4))
        for d_lat in (-1, 0, 1):
            for d_lon in (-1, 0, 1):
                for other_lat, other_lon in labelled_cells.get((cell[0] + d_lat, cell[1] + d_lon), []):
                    distance_km = 111 * math.hypot(latitude - other_lat, (longitude - other_lon) * math.cos(math.radians(latitude)))
                    if distance_km < 30:
                        labelable = False
        if labelable:
            labelled_cells.setdefault(cell, []).append((latitude, longitude))
    city.insert(7, int(labelable))
(output_directory / "cities.json").write_text(json.dumps(cities, ensure_ascii=False, separators=(",", ":")))
print(len(zone_names), "zones;", len(cities), "cities;", sorted(set(np.unique(indices)) - {0}).__len__(), "zones drawn")
