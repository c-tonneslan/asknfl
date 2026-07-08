#!/usr/bin/env python3
"""Build public/pbp.parquet from nflverse play-by-play releases.

Downloads one full-season parquet per season from nflverse-data, trims each to
the columns the app exposes (see COLUMNS), stamps the `season`, concatenates,
and writes a single ZSTD parquet the browser loads into DuckDB-WASM.

Usage:
    python3 scripts/build_pbp.py                # default seasons below
    python3 scripts/build_pbp.py 2018 2019 2020 # explicit seasons
"""

import os
import sys
import urllib.request

import duckdb

# The seasons shipped in the demo. Widen this list to cover more years; each
# season adds ~2.7 MB to the download the browser pays on first query.
DEFAULT_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025]

# The columns the app exposes (must match src/lib/schema.ts, minus `season`
# which is added here). Kept explicit so a schema change is a deliberate edit.
COLUMNS = [
    "play_id", "game_id", "home_team", "away_team", "week", "season_type",
    "posteam", "defteam", "yardline_100", "qtr", "down", "ydstogo", "goal_to_go",
    "game_seconds_remaining", "play_type", "desc", "yards_gained", "pass_length",
    "pass_location", "air_yards", "yards_after_catch", "run_location", "run_gap",
    "shotgun", "no_huddle", "qb_scramble", "field_goal_result", "kick_distance",
    "extra_point_result", "two_point_conv_result", "sack", "interception",
    "fumble", "fumble_lost", "touchdown", "pass_touchdown", "rush_touchdown",
    "penalty", "penalty_team", "penalty_type", "penalty_yards",
    "passer_player_name", "rusher_player_name", "receiver_player_name", "epa",
    "wpa", "cpoe", "success", "first_down", "home_score", "away_score",
    "posteam_score", "defteam_score", "score_differential", "home_wp", "away_wp",
    "wp",
]

RELEASE = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{year}.parquet"
CACHE = "/tmp/nflverse_pbp"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "pbp.parquet")


def season_file(year: int) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"play_by_play_{year}.parquet")
    if not os.path.exists(path):
        print(f"  downloading {year} …", flush=True)
        urllib.request.urlretrieve(RELEASE.format(year=year), path)
    return path


def main() -> None:
    seasons = [int(a) for a in sys.argv[1:]] or DEFAULT_SEASONS
    sel = "season, " + ", ".join(f'"{c}"' for c in COLUMNS)
    reads = [
        f"SELECT {sel} FROM read_parquet('{season_file(y)}')" for y in seasons
    ]
    union = "\nUNION ALL BY NAME\n".join(reads)

    con = duckdb.connect()
    out = os.path.normpath(OUT)
    print(f"seasons: {seasons}")
    con.execute(
        f"COPY ({union} ORDER BY season, game_id, play_id) "
        f"TO '{out}' (FORMAT parquet, COMPRESSION zstd)"
    )

    n, lo, hi = con.execute(
        f"SELECT COUNT(*), MIN(season), MAX(season) FROM read_parquet('{out}')"
    ).fetchone()
    print(f"wrote {out}: {n:,} rows, seasons {lo}-{hi}, "
          f"{os.path.getsize(out) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
