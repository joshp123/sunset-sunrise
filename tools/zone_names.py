"""Each time zone's own abbreviations, from the IANA time zone database (via the tzdata package).

Written by AI on 2026.10.20 by model claude opus 5.5.
The database keeps an abbreviation only where it is in real use (GMT, BST, CET, EET, MSK, EST, IST, JST, AEST...);
elsewhere it writes the offset ("+05"), which the page shows as UTC+5.
Usage: zone_names.py <zones.json> <zone-names.json>
"""
import datetime as dt, json, sys, zoneinfo
import tzdata
zoneinfo.reset_tzpath(to=[])  # the packaged database, not the system's older copy
zones = json.load(open(sys.argv[1]))
names = {}
for zone in zones:
    if zone == "none":
        continue
    by_offset = {}
    for year in (2026, 2027):
        for month in (1, 7):
            moment = dt.datetime(year, month, 15, 12, tzinfo=dt.timezone.utc).astimezone(zoneinfo.ZoneInfo(zone))
            by_offset.setdefault(int(moment.utcoffset().total_seconds() // 60), moment.tzname())
    names[zone] = by_offset
json.dump(names, open(sys.argv[2], "w"), separators=(",", ":"))
print(tzdata.IANA_VERSION, len(names), "zones;", {z: names[z] for z in ["Africa/Cairo", "Africa/Algiers", "Asia/Dubai", "Asia/Yekaterinburg", "Europe/Moscow", "Asia/Kolkata", "Europe/London", "Asia/Jerusalem", "America/New_York", "Asia/Shanghai"]})
