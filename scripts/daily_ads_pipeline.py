#!/usr/bin/env python3
"""Daily CIAN ads parser + history/master/final report pipeline."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

AD_ID_REGEX = re.compile(r"/(\d+)(?:/|\?|$)")
NEXT_DATA_REGEX = re.compile(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL)

DAILY_ALIASES = {
    "apartment_name": ["Наша квартира", "name", "apartment_name"],
    "ad_id": ["ID", "id", "ad_id"],
    "url": ["Ссылка", "url", "link"],
    "address": ["Адрес", "address"],
    "created_date": ["Дата создания", "created_date", "created_at_source"],
    "price": ["Цена", "price"],
}

HISTORY_FIELDS = ["ad_id", "parse_date", "price", "address", "url", "created_at"]
MASTER_FIELDS = [
    "apartment_name",
    "ad_id",
    "url",
    "address",
    "created_date",
    "first_parse_date",
    "price",
    "life_days",
    "last_seen_date",
]
FINAL_FIELDS = [
    "Наша квартира",
    "ID",
    "Ссылка",
    "Адрес",
    "Дата создания",
    "Дата первого парсинга",
    "Цена",
    "Срок жизни, дни",
]


@dataclass
class AddressSpec:
    apartment_name: str
    time_to_metro: int
    metro_station: str


@dataclass
class DailyRow:
    apartment_name: str
    ad_id: str
    url: str
    address: str
    created_date: str
    price: str


def read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: Iterable[Dict[str, str]], fieldnames: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def resolve_column(row: Dict[str, str], aliases: Sequence[str]) -> str:
    for alias in aliases:
        if alias in row and row[alias] is not None:
            return row[alias].strip()
    return ""


def extract_ad_id(url: str) -> str:
    match = AD_ID_REGEX.search(url or "")
    return match.group(1) if match else ""


def _dig_first(dct: Dict[str, Any], paths: Sequence[Sequence[str]]) -> Optional[Any]:
    for path in paths:
        cur: Any = dct
        ok = True
        for key in path:
            if not isinstance(cur, dict) or key not in cur:
                ok = False
                break
            cur = cur[key]
        if ok and cur is not None:
            return cur
    return None


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _extract_next_data(html: str) -> Dict[str, Any]:
    match = NEXT_DATA_REGEX.search(html)
    if not match:
        return {}
    payload = match.group(1).strip()
    if not payload:
        return {}
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {}


def _normalize_offer(offer: Dict[str, Any], apartment_name: str) -> Optional[DailyRow]:
    raw_url = _dig_first(
        offer,
        [
            ["fullUrl"],
            ["url"],
            ["link"],
        ],
    )
    if not raw_url:
        return None

    url = raw_url if str(raw_url).startswith("http") else urljoin("https://www.cian.ru", str(raw_url))
    ad_id = str(_dig_first(offer, [["id"], ["offerId"]]) or extract_ad_id(url))
    if not ad_id:
        return None

    address = _dig_first(offer, [["geo", "userInput"], ["geo", "address"], ["address"]])
    created = _dig_first(
        offer,
        [
            ["addedTimestamp"],
            ["creationDate"],
            ["creationDateTime"],
            ["createdAt"],
        ],
    )
    price = _dig_first(offer, [["bargainTerms", "priceRur"], ["price"], ["priceRur"]])

    created_str = ""
    if isinstance(created, (int, float)):
        created_str = dt.datetime.fromtimestamp(created, tz=dt.timezone.utc).strftime("%d.%m.%Y %H:%M")
    elif created is not None:
        created_str = str(created)

    return DailyRow(
        apartment_name=apartment_name,
        ad_id=ad_id,
        url=url,
        address=str(address or "").strip(),
        created_date=created_str,
        price=str(price or "").strip(),
    )


def parse_cian_html(html: str, apartment_name: str) -> List[DailyRow]:
    next_data = _extract_next_data(html)
    if not next_data:
        return []

    offers: Dict[str, DailyRow] = {}
    for node in _walk(next_data):
        if not any(key in node for key in ("fullUrl", "url")):
            continue
        normalized = _normalize_offer(node, apartment_name)
        if normalized and normalized.ad_id:
            offers[normalized.ad_id] = normalized

    return list(offers.values())


def load_addresses(path: Path) -> List[AddressSpec]:
    rows = read_csv(path)
    out: List[AddressSpec] = []
    for row in rows:
        name = resolve_column(row, ["name", "Наша квартира", "apartment_name"])
        time_raw = resolve_column(row, ["time", "time_station", "time_to_metro"])
        metro = resolve_column(row, ["metro_station", "metro", "station", "станция"])
        if not name or not time_raw or not metro:
            continue
        try:
            minutes = int(float(time_raw.replace(",", ".")))
        except ValueError:
            continue
        out.append(AddressSpec(apartment_name=name, time_to_metro=minutes, metro_station=metro))
    return out


def fetch_cian_for_address(spec: AddressSpec, region: str, pages: int, timeout_s: int) -> List[DailyRow]:
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}

    min_time = max(0, spec.time_to_metro - 2)
    max_time = spec.time_to_metro + 2

    collected: Dict[str, DailyRow] = {}
    for p in range(1, pages + 1):
        params = {
            "deal_type": "rent",
            "engine_version": "2",
            "offer_type": "flat",
            "region": region,
            "metro[0]": spec.metro_station,
            "foot_min": str(min_time),
            "foot_max": str(max_time),
            "only_foot": "2",
            "p": str(p),
        }
        query = urlencode(params)
        req = Request(f"https://www.cian.ru/cat.php?{query}", headers=headers)
        with urlopen(req, timeout=timeout_s) as response:
            html = response.read().decode("utf-8", errors="ignore")
        rows = parse_cian_html(html, spec.apartment_name)
        if not rows:
            break
        for row in rows:
            collected[row.ad_id] = row

    return list(collected.values())


def collect_daily_rows(addresses_csv: Path, region: str, pages: int, timeout_s: int) -> List[DailyRow]:
    result: Dict[tuple[str, str], DailyRow] = {}
    for spec in load_addresses(addresses_csv):
        for row in fetch_cian_for_address(spec, region=region, pages=pages, timeout_s=timeout_s):
            result[(spec.apartment_name, row.ad_id)] = row
    return list(result.values())


def normalize_daily_rows(rows: List[Dict[str, str]]) -> List[DailyRow]:
    normalized: List[DailyRow] = []
    for raw in rows:
        data = {k: resolve_column(raw, v) for k, v in DAILY_ALIASES.items()}
        if not data["ad_id"]:
            data["ad_id"] = extract_ad_id(data["url"])
        if not data["ad_id"]:
            continue
        normalized.append(
            DailyRow(
                apartment_name=data["apartment_name"],
                ad_id=data["ad_id"],
                url=data["url"],
                address=data["address"],
                created_date=data["created_date"],
                price=data["price"],
            )
        )
    return normalized


def update_history(history_path: Path, daily_rows: List[DailyRow], parse_date: str) -> None:
    history = read_csv(history_path)
    keyset = {(r["ad_id"], r["parse_date"]) for r in history if r.get("ad_id") and r.get("parse_date")}
    now = dt.datetime.now(dt.timezone.utc).isoformat()

    for row in daily_rows:
        key = (row.ad_id, parse_date)
        if key in keyset:
            continue
        history.append(
            {
                "ad_id": row.ad_id,
                "parse_date": parse_date,
                "price": row.price,
                "address": row.address,
                "url": row.url,
                "created_at": now,
            }
        )
        keyset.add(key)

    history.sort(key=lambda x: (x["ad_id"], x["parse_date"]))
    write_csv(history_path, history, HISTORY_FIELDS)


def update_master(master_path: Path, daily_rows: List[DailyRow], parse_date: str) -> List[Dict[str, str]]:
    master_rows = read_csv(master_path)
    master: Dict[str, Dict[str, str]] = {r["ad_id"]: r for r in master_rows if r.get("ad_id")}

    today_map = {r.ad_id: r for r in daily_rows}
    prev_day = (dt.date.fromisoformat(parse_date) - dt.timedelta(days=1)).isoformat()

    for ad_id, current in master.items():
        if ad_id not in today_map:
            current["life_days"] = "0"

    for ad_id, row in today_map.items():
        if ad_id not in master:
            master[ad_id] = {
                "apartment_name": row.apartment_name,
                "ad_id": row.ad_id,
                "url": row.url,
                "address": row.address,
                "created_date": row.created_date,
                "first_parse_date": parse_date,
                "price": row.price,
                "life_days": "0",
                "last_seen_date": parse_date,
            }
            continue

        prev = master[ad_id]
        prev_life = int(prev.get("life_days") or 0)
        prev_seen = prev.get("last_seen_date")
        life_days = prev_life + 1 if prev_seen == prev_day else 0

        prev.update(
            {
                "apartment_name": row.apartment_name or prev.get("apartment_name", ""),
                "url": row.url,
                "address": row.address,
                "created_date": row.created_date or prev.get("created_date", ""),
                "price": row.price,
                "life_days": str(life_days),
                "last_seen_date": parse_date,
            }
        )

    output = sorted(master.values(), key=lambda x: x["ad_id"])
    write_csv(master_path, output, MASTER_FIELDS)
    return output


def build_final_report(output_path: Path, daily_rows: List[DailyRow], master_rows: List[Dict[str, str]]) -> None:
    by_id = {m["ad_id"]: m for m in master_rows}
    final_rows: List[Dict[str, str]] = []

    for row in sorted(daily_rows, key=lambda x: x.apartment_name):
        state = by_id[row.ad_id]
        final_rows.append(
            {
                "Наша квартира": row.apartment_name,
                "ID": row.ad_id,
                "Ссылка": row.url,
                "Адрес": row.address,
                "Дата создания": row.created_date,
                "Дата первого парсинга": state.get("first_parse_date", ""),
                "Цена": row.price,
                "Срок жизни, дни": state.get("life_days", "0"),
            }
        )

    write_csv(output_path, final_rows, FINAL_FIELDS)


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily CIAN parser + history/lifetime processing")
    parser.add_argument("--daily-csv", help="Ready raw daily CSV. If omitted, data is scraped from CIAN")
    parser.add_argument("--addresses-csv", help="CSV with our addresses/time/metro_station")
    parser.add_argument("--parsed-daily-csv", help="Where to save scraped raw daily CSV")
    parser.add_argument("--history-csv", default="data/history.csv")
    parser.add_argument("--master-csv", default="data/master.csv")
    parser.add_argument("--output-csv", default="data/final_report.csv")
    parser.add_argument("--parse-date", default=dt.date.today().isoformat())
    parser.add_argument("--region", default="1", help="CIAN region id, default 1 (Moscow)")
    parser.add_argument("--pages", type=int, default=3, help="How many pages per address to scan")
    parser.add_argument("--timeout", type=int, default=25, help="HTTP timeout in seconds")
    args = parser.parse_args()

    if not args.daily_csv and not args.addresses_csv:
        raise SystemExit("Нужно передать --daily-csv или --addresses-csv")

    if args.daily_csv:
        daily = normalize_daily_rows(read_csv(Path(args.daily_csv)))
    else:
        daily = collect_daily_rows(Path(args.addresses_csv), region=args.region, pages=args.pages, timeout_s=args.timeout)
        if args.parsed_daily_csv:
            write_csv(
                Path(args.parsed_daily_csv),
                [
                    {
                        "Наша квартира": r.apartment_name,
                        "ID": r.ad_id,
                        "Ссылка": r.url,
                        "Адрес": r.address,
                        "Дата создания": r.created_date,
                        "Цена": r.price,
                    }
                    for r in daily
                ],
                ["Наша квартира", "ID", "Ссылка", "Адрес", "Дата создания", "Цена"],
            )

    update_history(Path(args.history_csv), daily, args.parse_date)
    master = update_master(Path(args.master_csv), daily, args.parse_date)
    build_final_report(Path(args.output_csv), daily, master)


if __name__ == "__main__":
    main()
