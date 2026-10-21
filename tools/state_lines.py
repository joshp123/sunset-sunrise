"""US state and Canadian province boundary lines for the map, from Natural Earth (public domain).

Written by AI on 2026.10.21 by model claude opus 5.5.
Input: ne_50m_admin_1_states_provinces_lines.geojson (github.com/nvkelso/natural-earth-vector, geojson/).
Usage: state_lines.py <ne_50m_admin_1_states_provinces_lines.geojson> data/state-lines.json
"""
import json, sys
features = json.load(open(sys.argv[1]))["features"]
lines = []
for feature in features:
    if feature["properties"]["ADM0_A3"] not in ("USA", "CAN"):
        continue
    geometry = feature["geometry"]
    for line in geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]:
        lines.append([[round(lon, 3), round(lat, 3)] for lon, lat in line])
json.dump(lines, open(sys.argv[2], "w"), separators=(",", ":"))
print(len(lines), "lines,", sum(len(line) for line in lines), "points")
