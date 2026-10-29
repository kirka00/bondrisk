"""Клиент MOEX ISS с кэшем сырых ответов (data/raw/moex) и ретраями."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from bondrisk.settings import get_settings

log = logging.getLogger("bondrisk.moex")


class MoexClient:
    def __init__(self, cache: bool | None = None) -> None:
        s = get_settings()
        self.base = s.moex_base_url
        self.raw = Path(s.raw_dir) / "moex"
        self.cache = s.raw_cache if cache is None else cache
        self.http = httpx.Client(
            timeout=s.http_timeout, headers={"User-Agent": "bondrisk/0.1 (study project)"}
        )

    # ---------- низкоуровневое ----------
    def _cache_path(self, path: str, params: dict[str, Any]) -> Path:
        key = (
            path.strip("/").replace("/", "_")
            + "_"
            + "_".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "iss.meta")
        )
        if len(key) > 180:
            key = key[:140] + "_" + hashlib.md5(key.encode()).hexdigest()[:16]
        return self.raw / (key + ".json")

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        params.setdefault("iss.meta", "off")
        cache = self._cache_path(path, params)
        if self.cache and cache.exists():
            return json.loads(cache.read_text())
        last: Exception | None = None
        for attempt in range(5):
            try:
                r = self.http.get(f"{self.base}/{path.strip('/')}.json", params=params)
                if r.status_code >= 500:
                    raise httpx.HTTPStatusError("server error", request=r.request, response=r)
                r.raise_for_status()
                data = r.json()
                break
            except (httpx.HTTPError, json.JSONDecodeError) as e:  # noqa: PERF203
                last = e
                time.sleep(1.5 * (attempt + 1))
        else:
            raise RuntimeError(f"MOEX {path}: {last}")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(data, ensure_ascii=False))
        return data

    @staticmethod
    def rows(block: dict[str, Any] | None) -> list[dict[str, Any]]:
        if not block:
            return []
        cols = block["columns"]
        return [dict(zip(cols, row, strict=True)) for row in block["data"]]

    # ---------- справочники ----------
    def board_bonds(self, board: str) -> list[dict[str, Any]]:
        """Выпуски доски с ликвидностью (marketdata.VALTODAY)."""
        d = self.get(
            f"engines/stock/markets/bonds/boards/{board}/securities",
            **{
                "iss.only": "securities,marketdata",
                "securities.columns": "SECID,ISIN,SHORTNAME,SECNAME,FACEUNIT,FACEVALUE,MATDATE,OFFERDATE,"
                "PUTOPTIONDATE,CALLOPTIONDATE,COUPONPERCENT,COUPONPERIOD,ISSUESIZE,LISTLEVEL,PREVPRICE,"
                "PREVDATE,BONDTYPE,BONDSUBTYPE,SECTYPE,REGNUMBER",
                "marketdata.columns": "SECID,VALTODAY,NUMTRADES",
            },
        )
        md = {m["SECID"]: m for m in self.rows(d.get("marketdata"))}
        out = []
        for s in self.rows(d["securities"]):
            s["VALTODAY"] = (md.get(s["SECID"]) or {}).get("VALTODAY")
            s["BOARD"] = board
            out.append(s)
        return out

    def securities_index(self) -> dict[str, dict[str, Any]]:
        """ISIN → {emitent_id, emitent_title, emitent_inn, primary_boardid} по всем торгуемым облигациям."""
        out: dict[str, dict[str, Any]] = {}
        start = 0
        while True:
            d = self.get(
                "securities",
                engine="stock",
                market="bonds",
                is_trading=1,
                start=start,
                limit=100,
                **{
                    "securities.columns": "secid,isin,emitent_id,emitent_title,emitent_inn,primary_boardid"
                },
            )
            page = self.rows(d["securities"])
            for r in page:
                if r.get("isin"):
                    out[r["isin"]] = r
            if len(page) < 100:
                return out
            start += 100

    def description(self, secid: str) -> dict[str, str]:
        d = self.get(f"securities/{secid}", **{"iss.only": "description"})
        return {r["name"]: r["value"] for r in self.rows(d["description"])}

    def boards(self, secid: str) -> list[dict[str, Any]]:
        d = self.get(
            f"securities/{secid}",
            **{"iss.only": "boards", "boards.columns": "boardid,is_primary,is_traded,currencyid"},
        )
        return self.rows(d.get("boards"))

    def lookup(self, query: str) -> dict[str, Any] | None:
        """Поиск бумаги по ISIN/secid → secid, emitent_id, emitent_title, emitent_inn, primary_boardid."""
        d = self.get(
            "securities",
            q=query,
            **{
                "securities.columns": "secid,isin,emitent_id,emitent_title,emitent_inn,primary_boardid,is_traded"
            },
        )
        rows = [r for r in self.rows(d["securities"]) if query in (r.get("isin"), r.get("secid"))]
        rows.sort(key=lambda r: r.get("is_traded") or 0, reverse=True)
        return rows[0] if rows else None

    def index_composition(self, index: str, on: str | None = None) -> list[dict[str, Any]]:
        """Состав индекса с весами; on='YYYY-MM-DD' — исторический состав на дату (по умолчанию — текущий)."""
        out: list[dict[str, Any]] = []
        start = 0
        extra = {"date": on} if on else {}
        while True:
            d = self.get(
                f"statistics/engines/stock/markets/index/analytics/{index}",
                limit=100,
                start=start,
                **extra,
            )
            page = self.rows(d["analytics"])
            out.extend(page)
            if len(page) < 100:
                return out
            start += 100

    def bondization(self, secid: str) -> dict[str, list[dict[str, Any]]]:
        d = self.get(
            f"statistics/engines/stock/markets/bonds/bondization/{secid}", limit="unlimited"
        )
        return {k: self.rows(d.get(k)) for k in ("coupons", "amortizations", "offers")}

    # ---------- временные ряды ----------
    def history(self, secid: str, board: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        start = 0
        while True:
            d = self.get(
                f"history/engines/stock/markets/bonds/boards/{board}/securities/{secid}",
                **{
                    "iss.only": "history",
                    "from": date_from,
                    "till": date_to,
                    "start": start,
                    "history.columns": "TRADEDATE,CLOSE,LEGALCLOSEPRICE,WAPRICE,YIELDCLOSE,DURATION,VOLUME,"
                    "FACEVALUE,ACCINT",
                },
            )
            page = self.rows(d["history"])
            out.extend(page)
            if len(page) < 100:
                return out
            start += 100

    def zcyc(self, date: str) -> list[dict[str, Any]]:
        d = self.get("engines/stock/zcyc", **{"iss.only": "yearyields", "date": date})
        return self.rows(d.get("yearyields"))
