"""Официальные курсы Банка России (XML_dynamic, windows-1251)."""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

import httpx

from bondrisk.settings import get_settings

log = logging.getLogger("bondrisk.cbr")

# в кассу методологии (§2) входят рубль, доллар, евро, юань и фунт
CBR_CODES = {"USD": "R01235", "EUR": "R01239", "CNY": "R01375", "GBP": "R01035"}


def fx_dynamic(currency: str, date_from: date, date_to: date) -> list[tuple[date, str, float]]:
    s = get_settings()
    code = CBR_CODES[currency]
    url = (
        f"{s.cbr_base_url}/XML_dynamic.asp?date_req1={date_from:%d/%m/%Y}"
        f"&date_req2={date_to:%d/%m/%Y}&VAL_NM_RQ={code}"
    )
    cache = Path(s.raw_dir) / "cbr" / f"{currency}_{date_from}_{date_to}.xml"
    if s.raw_cache and cache.exists():
        raw = cache.read_bytes()
    else:
        r = httpx.get(url, timeout=s.http_timeout, headers={"User-Agent": "bondrisk/0.1"})
        r.raise_for_status()
        raw = r.content
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(raw)
    root = ET.fromstring(raw)
    out = []
    for rec in root.findall("Record"):
        d = datetime.strptime(rec.get("Date"), "%d.%m.%Y").date()
        nominal = float(re.sub(",", ".", rec.findtext("Nominal", "1")))
        value = float(re.sub(",", ".", rec.findtext("Value", "0")))
        if value > 0:
            out.append((d, currency, value / nominal))
    return out
