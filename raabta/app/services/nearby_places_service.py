"""Fetch real nearby landmarks from OpenStreetMap (server-side proxy)."""

from __future__ import annotations

import json
import math
from typing import Any
from urllib import parse, request

USER_AGENT = "RaabtaLink/1.0 (emergency-sos-app)"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse"
PHOTON_URL = "https://photon.komoot.io/api/"

GENERIC_NAMES = {
    "hospital", "mosque", "school", "shop", "restaurant", "market",
    "store", "pharmacy", "park", "bank", "atm", "office",
}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _http_json(url: str, *, method: str = "GET", data: bytes | None = None, headers: dict | None = None) -> Any:
    hdrs = {"User-Agent": USER_AGENT, **(headers or {})}
    req = request.Request(url, data=data, headers=hdrs, method=method)
    with request.urlopen(req, timeout=12) as resp:
        return json.loads(resp.read().decode())


def _reverse_geocode(lat: float, lon: float, lang: str) -> dict:
    try:
        qs = parse.urlencode(
            {"lat": lat, "lon": lon, "format": "json", "zoom": 18, "addressdetails": 1}
        )
        return _http_json(
            f"{NOMINATIM_REVERSE}?{qs}",
            headers={"Accept-Language": lang},
        )
    except Exception:
        return {}


def _area_label(data: dict) -> str | None:
    address = data.get("address") or {}
    parts = [
        address.get("neighbourhood") or address.get("suburb") or address.get("quarter"),
        address.get("city_district") or address.get("borough") or address.get("city"),
    ]
    parts = [p for p in parts if p]
    if parts:
        return ", ".join(parts[:2])
    display = data.get("display_name") or ""
    return ", ".join(display.split(",")[:2]).strip() or None


def _search_terms_from_address(address: dict) -> list[str]:
    keys = ("neighbourhood", "suburb", "quarter", "city_district", "borough", "district", "town")
    terms: list[str] = []
    seen: set[str] = set()
    for key in keys:
        val = (address.get(key) or "").strip()
        if len(val) < 3:
            continue
        low = val.lower()
        if low in seen:
            continue
        seen.add(low)
        terms.append(val)
    return terms[:4]


def _osm_category(tags: dict) -> str:
    if tags.get("shop") in {"mall", "supermarket", "department_store"}:
        return "mall"
    amenity = tags.get("amenity")
    if amenity in {"hospital", "clinic"}:
        return "hospital"
    if amenity == "place_of_worship":
        return "worship"
    if amenity in {"school", "college", "university"}:
        return "school"
    if tags.get("leisure") in {"park", "stadium", "playground"}:
        return "park"
    if amenity in {"marketplace", "pharmacy"}:
        return "market"
    if tags.get("place"):
        return "area"
    if tags.get("highway") == "bus_stop":
        return "place"
    return "place"


def _photon_category(props: dict) -> str:
    key = props.get("osm_key") or ""
    val = props.get("osm_value") or ""
    tags: dict[str, str] = {}
    if key and val:
        tags[key] = val
    if key == "amenity":
        tags["amenity"] = val
    if key == "shop":
        tags["shop"] = val
    if key == "leisure":
        tags["leisure"] = val
    if key == "place":
        tags["place"] = val
    return _osm_category(tags)


def _is_valid_place(name: str, props: dict, distance_km: float, max_km: float) -> bool:
    if distance_km > max_km:
        return False
    if len(name) < 3:
        return False
    if name.lower() in GENERIC_NAMES:
        return False
    country = (props.get("countrycode") or "").upper()
    if country and country != "PK":
        return False
    osm_key = props.get("osm_key") or ""
    if osm_key in {"highway", "landuse", "boundary"}:
        return False
    return True


def _fetch_photon_places(lat: float, lon: float, radius_m: int, search_terms: list[str]) -> list[dict]:
    max_km = radius_m / 1000.0
    seen: set[str] = set()
    places: list[dict] = []

    queries = list(search_terms)
    if not queries:
        queries = ["Karachi"]

    for query in queries:
        try:
            qs = parse.urlencode({"q": query, "lat": str(lat), "lon": str(lon), "limit": "20"})
            data = _http_json(f"{PHOTON_URL}?{qs}")
        except Exception:
            continue

        for feature in data.get("features") or []:
            props = feature.get("properties") or {}
            name_en = (props.get("name") or "").strip()
            if not name_en:
                continue
            coords = feature.get("geometry", {}).get("coordinates") or []
            if len(coords) < 2:
                continue
            el_lon, el_lat = coords[0], coords[1]
            distance_km = _haversine_km(lat, lon, el_lat, el_lon)
            if not _is_valid_place(name_en, props, distance_km, max_km):
                continue
            key = name_en.lower()
            if key in seen:
                continue
            seen.add(key)
            places.append(
                {
                    "name_en": name_en,
                    "name_ur": name_en,
                    "lat": el_lat,
                    "lon": el_lon,
                    "distance_km": round(distance_km, 3),
                    "category": _photon_category(props),
                }
            )

    places.sort(key=lambda p: p["distance_km"])
    return places


def _fetch_overpass_places(lat: float, lon: float, radius_m: int) -> list[dict]:
    query = f"""
[out:json][timeout:12];
(
  nwr["name"]["shop"~"mall|supermarket|department_store"](around:{radius_m},{lat},{lon});
  nwr["name"]["amenity"~"hospital|clinic|pharmacy|school|college|university|place_of_worship|marketplace|bus_station"](around:{radius_m},{lat},{lon});
  nwr["name"]["leisure"~"park|stadium|playground"](around:{radius_m},{lat},{lon});
  nwr["name"](around:{radius_m},{lat},{lon});
);
out center 30;
"""
    body = parse.urlencode({"data": query}).encode()
    for url in OVERPASS_URLS:
        try:
            payload = _http_json(url, method="POST", data=body)
        except Exception:
            continue

        seen: set[str] = set()
        places: list[dict] = []
        for el in payload.get("elements") or []:
            tags = el.get("tags") or {}
            name_en = (tags.get("name:en") or tags.get("name") or "").strip()
            if len(name_en) < 3 or name_en.lower() in GENERIC_NAMES:
                continue
            name_ur = (tags.get("name:ur") or name_en).strip()
            el_lat = el.get("lat") or (el.get("center") or {}).get("lat")
            el_lon = el.get("lon") or (el.get("center") or {}).get("lon")
            if el_lat is None or el_lon is None:
                continue
            key = name_en.lower()
            if key in seen:
                continue
            seen.add(key)
            distance_km = _haversine_km(lat, lon, el_lat, el_lon)
            places.append(
                {
                    "name_en": name_en,
                    "name_ur": name_ur,
                    "lat": el_lat,
                    "lon": el_lon,
                    "distance_km": round(distance_km, 3),
                    "category": _osm_category(tags),
                }
            )
        if places:
            places.sort(key=lambda p: p["distance_km"])
            return places
    return []


def get_nearby_places(lat: float, lon: float, radius_m: int = 1500, limit: int = 10) -> dict:
    geo_en = _reverse_geocode(lat, lon, "en")
    geo_ur = _reverse_geocode(lat, lon, "ur")
    area_en = _area_label(geo_en)
    area_ur = _area_label(geo_ur)
    search_terms = _search_terms_from_address(geo_en.get("address") or {})

    places = _fetch_overpass_places(lat, lon, radius_m)
    if len(places) < 3:
        photon = _fetch_photon_places(lat, lon, radius_m, search_terms)
        merged = {p["name_en"].lower(): p for p in places}
        for p in photon:
            merged.setdefault(p["name_en"].lower(), p)
        places = sorted(merged.values(), key=lambda p: p["distance_km"])

    if len(places) < 3 and radius_m < 3000:
        wider = _fetch_photon_places(lat, lon, 3000, search_terms)
        merged = {p["name_en"].lower(): p for p in places}
        for p in wider:
            merged.setdefault(p["name_en"].lower(), p)
        places = sorted(merged.values(), key=lambda p: p["distance_km"])

    return {
        "area": {"en": area_en, "ur": area_ur},
        "places": places[:limit],
    }
