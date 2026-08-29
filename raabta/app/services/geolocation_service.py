"""Geolocation fallback — provides a default location when the client
doesn't send GPS coordinates (e.g. during testing or when GPS is denied).

Fully offline — no cloud API calls.  The PWA client should use
navigator.geolocation to capture real GPS and send it with the request.
This service is only a safety net for the server side.
"""

# Default location used when the client doesn't provide GPS.
# Change these to match your deployment area.
DEFAULT_LAT = 24.8607
DEFAULT_LON = 67.0011
DEFAULT_CITY = "Karachi"
DEFAULT_COUNTRY = "Pakistan"


def resolve_gps(latitude, longitude):
    """Return (lat, lon) — uses the given values or falls back to defaults."""
    if latitude is not None and longitude is not None:
        return latitude, longitude
    return DEFAULT_LAT, DEFAULT_LON
