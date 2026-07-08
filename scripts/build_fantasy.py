#!/usr/bin/env python3
"""Build public/fantasy.parquet from nflverse weekly player-stats releases.

One row per offensive player per regular-season week, trimmed to the columns a
fantasy tool needs. Fantasy points are computed in the browser from these
components so the scoring format (standard / half-PPR / PPR) is a toggle.

Usage:
    python3 scripts/build_fantasy.py                 # default seasons below
    python3 scripts/build_fantasy.py 2018 2019 2020
"""

import os
import sys
import urllib.request

import duckdb

# Weekly stats are published through 2024 at build time; extend as nflverse ships.
DEFAULT_SEASONS = [2020, 2021, 2022, 2023, 2024]

COLUMNS = [
    "season", "week", "season_type", "player_id",
    "player_display_name AS player", "position", "team", "opponent_team",
    "passing_yards", "passing_tds", "passing_interceptions", "sack_fumbles_lost",
    "passing_2pt_conversions", "passing_epa",
    "carries", "rushing_yards", "rushing_tds", "rushing_fumbles_lost",
    "rushing_2pt_conversions", "rushing_epa",
    "targets", "receptions", "receiving_yards", "receiving_tds",
    "receiving_fumbles_lost", "receiving_2pt_conversions", "target_share",
    "receiving_epa",
]

RELEASE = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_{year}.parquet"
CACHE = "/tmp/nflverse_playerstats"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "fantasy.parquet")


def season_file(year: int) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"stats_player_week_{year}.parquet")
    if not os.path.exists(path):
        print(f"  downloading {year} …", flush=True)
        urllib.request.urlretrieve(RELEASE.format(year=year), path)
    return path


def main() -> None:
    seasons = [int(a) for a in sys.argv[1:]] or DEFAULT_SEASONS
    sel = ", ".join(COLUMNS)
    reads = [
        f"SELECT {sel} FROM read_parquet('{season_file(y)}') "
        f"WHERE season_type = 'REG' AND position IN ('QB','RB','WR','TE')"
        for y in seasons
    ]
    union = "\nUNION ALL BY NAME\n".join(reads)

    con = duckdb.connect()
    out = os.path.normpath(OUT)
    con.execute(
        f"COPY ({union} ORDER BY season, week, player) "
        f"TO '{out}' (FORMAT parquet, COMPRESSION zstd)"
    )
    n, lo, hi, players = con.execute(
        f"SELECT COUNT(*), MIN(season), MAX(season), COUNT(DISTINCT player_id) "
        f"FROM read_parquet('{out}')"
    ).fetchone()
    print(f"wrote {out}: {n:,} player-weeks, {players:,} players, "
          f"seasons {lo}-{hi}, {os.path.getsize(out) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
