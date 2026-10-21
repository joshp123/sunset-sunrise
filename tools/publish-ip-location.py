#!/usr/bin/env python3
"""Build and publish the complete DB-IP City Lite IPv4 and IPv6 range table."""

import argparse
import csv
import datetime
import getpass
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import socket
import struct
import tempfile
import time
import urllib.error
import urllib.request

RECORD = struct.Struct('<16s16sdd2s')
CHUNK_RECORDS = 1024
PART_RECORDS = CHUNK_RECORDS * 128


class FamilyWriter:
    def __init__(self, output, prefix, family):
        self.output = output
        self.prefix = prefix
        self.family = family
        self.rows = 0
        self.previous_end = None
        self.part_keys = []
        self.part = None
        self.index_key = f'{prefix}/ipv{family}-index.bin'
        self.index = (output / Path(self.index_key).name).open('wb')

    def append(self, start, end, country, latitude, longitude):
        if start > end or (self.previous_end is not None and start <= self.previous_end):
            raise ValueError(f'IPv{self.family} row {self.rows + 1} is out of order or overlaps')
        if self.rows % PART_RECORDS == 0:
            if self.part:
                self.part.close()
            key = f'{self.prefix}/ipv{self.family}-part-{len(self.part_keys):04d}.bin'
            self.part_keys.append(key)
            self.part = (self.output / Path(key).name).open('wb')
        if self.rows % CHUNK_RECORDS == 0:
            self.index.write(start)
        self.part.write(RECORD.pack(start, end, latitude, longitude, country.encode('ascii')))
        self.previous_end = end
        self.rows += 1

    def close(self):
        self.index.close()
        if self.part:
            self.part.close()
        return {'rows': self.rows, 'indexKey': self.index_key, 'partKeys': self.part_keys}


def build_table(source, output, month):
    digest = hashlib.file_digest(source.open('rb'), 'sha256').hexdigest()
    version = f'{month}-{digest[:16]}'
    prefix = f'ip-location/{version}'
    writers = {family: FamilyWriter(output, prefix, family) for family in (4, 6)}
    with gzip.open(source, 'rt', newline='', encoding='utf-8') as compressed:
        for number, row in enumerate(csv.reader(compressed), 1):
            if len(row) != 8:
                raise ValueError(f'CSV row {number} has {len(row)} fields, expected 8')
            start_text, end_text, _continent, country, _region, _city, latitude_text, longitude_text = row
            family = 6 if ':' in start_text else 4
            socket_family = socket.AF_INET6 if family == 6 else socket.AF_INET
            start = socket.inet_pton(socket_family, start_text).rjust(16, b'\0')
            end = socket.inet_pton(socket_family, end_text).rjust(16, b'\0')
            latitude, longitude = float(latitude_text), float(longitude_text)
            if not re.fullmatch('[A-Z]{2}', country):
                raise ValueError(f'CSV row {number} has an invalid country code')
            if not math.isfinite(latitude) or not -90 <= latitude <= 90 or not math.isfinite(longitude) or not -180 <= longitude <= 180:
                raise ValueError(f'CSV row {number} has invalid coordinates')
            writers[family].append(start, end, country, latitude, longitude)
            if number % 1_000_000 == 0:
                print(f'Converted {number:,} rows', flush=True)
    families = {family: writer.close() for family, writer in writers.items()}
    manifest = {
        'format': 'dbip-city-ranges-v1',
        'version': version,
        'month': month,
        'sourceSha256': digest,
        'recordBytes': RECORD.size,
        'chunkRecords': CHUNK_RECORDS,
        'partRecords': PART_RECORDS,
        'families': families,
    }
    (output / 'current.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    return manifest


def put_object(site, key, path, token):
    data = path.read_bytes()
    content_type = 'application/json' if key.endswith('.json') else 'application/octet-stream'
    request = urllib.request.Request(
        f'{site.rstrip("/")}/__location/{key}', data=data, method='PUT',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': content_type},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.status not in (200, 201, 204):
                    raise RuntimeError(f'Upload failed with HTTP {response.status}')
            return
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError(f'Upload failed with HTTP {error.code} for {key}') from None
        except urllib.error.URLError:
            if attempt == 3:
                raise RuntimeError(f'Upload connection failed for {key}') from None
        time.sleep(2 ** attempt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--month', required=True, help='DB-IP release month, YYYY-MM')
    parser.add_argument('--file', type=Path, help='Existing monthly CSV.gz; otherwise download from DB-IP')
    parser.add_argument('--site', help='Site URL to receive the rebuilt table')
    parser.add_argument('--output-dir', type=Path, help='Keep built files here; otherwise use a temporary directory')
    parser.add_argument('--build-only', action='store_true', help='Build without publishing')
    args = parser.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}', args.month):
        parser.error('--month must be YYYY-MM')
    try:
        datetime.date.fromisoformat(f'{args.month}-01')
    except ValueError:
        parser.error('--month must be a valid month')
    if not args.build_only and (not args.site or not args.site.startswith('https://')):
        parser.error('--site must be an https URL when publishing')
    with tempfile.TemporaryDirectory(prefix='dbip-city-') as temporary:
        output = args.output_dir or Path(temporary) / 'table'
        output.mkdir(parents=True, exist_ok=True)
        source = args.file
        if source is None:
            source = Path(temporary) / f'dbip-city-lite-{args.month}.csv.gz'
            url = f'https://download.db-ip.com/free/{source.name}'
            print(f'Downloading {url}', flush=True)
            urllib.request.urlretrieve(url, source)
        manifest = build_table(source, output, args.month)
        data_keys = [key for family in manifest['families'].values() for key in family['partKeys']]
        index_keys = [family['indexKey'] for family in manifest['families'].values()]
        rows = sum(family['rows'] for family in manifest['families'].values())
        total_bytes = sum((output / Path(key).name).stat().st_size for key in data_keys + index_keys) + (output / 'current.json').stat().st_size
        print(f'{rows:,} ranges; {total_bytes:,} bytes; maximum lookup read {CHUNK_RECORDS * RECORD.size:,} bytes', flush=True)
        if args.build_only:
            return
        token = os.environ.get('IP_LOCATION_PUBLISH_TOKEN') or getpass.getpass('IP location publish token: ')
        if not token:
            parser.error('A publish token is required')
        for number, key in enumerate(data_keys + index_keys, 1):
            put_object(args.site, key, output / Path(key).name, token)
            print(f'Uploaded {number}/{len(data_keys) + len(index_keys)} objects', flush=True)
        put_object(args.site, 'ip-location/current.json', output / 'current.json', token)
        print(f'Published {args.month}: {rows:,} ranges', flush=True)


if __name__ == '__main__':
    main()
