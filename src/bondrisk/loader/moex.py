"""Тонкий клиент MOEX ISS. Сырые ответы кэшируются в data/raw, чтобы защита не зависела от сети."""

import json
from pathlib import Path
from typing import Any

import httpx

from bondrisk.settings import get_settings


class MoexClient:
    def __init__(self) -> None:
        s = get_settings()
        self.base = s.moex_base_url
        self.raw = Path(s.raw_dir) / "moex"
        self.http = httpx.Client(timeout=s.http_timeout, headers={"User-Agent": "bondrisk/0.1"})

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        params.setdefault("iss.meta", "off")
        cache = self.raw / (
            path.strip("/").replace("/", "_")
            + "_"
            + "_".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "iss.meta")
            + ".json"
        )
        if cache.exists():
            return json.loads(cache.read_text())
        r = self.http.get(f"{self.base}/{path.strip('/')}.json", params=params)
        r.raise_for_status()
        data = r.json()
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(data, ensure_ascii=False))
        return data

    @staticmethod
    def rows(block: dict[str, Any]) -> list[dict[str, Any]]:
        cols = block["columns"]
        return [dict(zip(cols, row, strict=True)) for row in block["data"]]

    def board_bonds(self, board: str = "TQOB") -> list[dict[str, Any]]:
        d = self.get(
            f"engines/stock/markets/bonds/boards/{board}/securities", **{"iss.only": "securities"}
        )
        return self.rows(d["securities"])

    def history(self, secid: str, board: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        start = 0
        while True:
            d = self.get(
                f"history/engines/stock/markets/bonds/boards/{board}/securities/{secid}",
                **{"iss.only": "history", "from": date_from, "till": date_to, "start": start},
            )
            page = self.rows(d["history"])
            out.extend(page)
            if len(page) < 100:
                return out
            start += 100

    def bondization(self, secid: str) -> dict[str, list[dict[str, Any]]]:
        d = self.get(
            f"statistics/engines/stock/markets/bonds/bondization/{secid}", limit="unlimited"
        )
        return {k: self.rows(d[k]) for k in ("coupons", "amortizations", "offers") if k in d}

    def zcyc(self, date: str) -> list[dict[str, Any]]:
        d = self.get("engines/stock/zcyc", **{"iss.only": "yearyields", "date": date})
        return self.rows(d["yearyields"])
