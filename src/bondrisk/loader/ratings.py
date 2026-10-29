"""Кредитные рейтинги из публичных раскрытий АКРА, НКР, НРА; непокрытые бумаги остаются без рейтинга."""

from __future__ import annotations

import html
import json
import logging
import re
import subprocess
import zipfile
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import text

from bondrisk.loader.db import LoadRun, rows, tx
from bondrisk.settings import get_settings

log = logging.getLogger("bondrisk.ratings")
UA = {"User-Agent": "Mozilla/5.0 (bondrisk study project)"}
AGENCY = {"ACRA": 2, "NKR": 3, "NRA": 4, "EXPERT_RA": 1}
OPF = (
    "публичное акционерное общество",
    "акционерное общество",
    "общество с ограниченной ответственностью",
    "закрытое",
    "открытое",
    "непубличное",
    "пао",
    "оао",
    "зао",
    "ооо",
    "ао",
    "нко",
    "мкб",
    "ук",
    "лк",
    "гк",
    "коммерческий банк",
    "банк",
    "компания",
    "корпорация",
    "финанс",
    "лизинг",
    "лизинговая",
    "ипотечный агент",
)


def _raw_dir() -> Path:
    p = Path(get_settings().raw_dir) / "ratings" / date.today().isoformat()
    p.mkdir(parents=True, exist_ok=True)
    return p


def _cached(name: str, fetch) -> bytes:
    p = _raw_dir() / name
    if get_settings().raw_cache and p.exists():
        return p.read_bytes()
    data = fetch()
    p.write_bytes(data)
    return data


def normalize_grade(raw: str | None) -> str | None:
    if not raw:
        return None
    g = raw.strip().replace("–", "-").replace("—", "-").replace("−", "-")
    if ".sf" in g.lower() or "(ru.sf)" in g.lower():
        return None
    g = re.sub(r"\(ru\)|\.ru|\|ru\||^ru", "", g, flags=re.I).strip()
    if g.startswith("e") and len(g) > 1 and g[1].isupper():
        return None  # ожидаемый рейтинг
    g = g.upper()
    if g in ("", "-", "—", "WD", "NR"):
        return None
    return g


# Полные наименования MOEX → краткие формы, под которыми эмитенты фигурируют у агентств
ALIASES = {
    "российские железные дороги": "ржд",
    "государственная транспортная лизинговая компания": "гтлк",
    "атомный энергопромышленный комплекс": "атомэнергопром",
    "сбербанк россии": "сбербанк",
    "акционерная финансовая корпорация система": "афк система",
    "горно-металлургическая компания норильский никель": "гмк норильский никель",
    "федеральная гидрогенерирующая компания - русгидро": "русгидро",
    "аэрофлот - российские авиалинии": "аэрофлот",
    "группа компаний самолет": "самолет",
    "банк псб": "псб",
    "сибур холдинг": "сибур",
    "территориальная генерирующая компания 14": "тгк-14",
    "магнитогорский металлургический комбинат": "ммк",
    "мобильные телесистемы": "мтс",
    "московский кредитный банк": "московский кредитный банк",
    "новолипецкий металлургический комбинат": "нлмк",
    "газпром капитал": "газпром капитал",
    "ростелеком": "ростелеком",
    "совкомбанк": "совкомбанк",
}


def normalize_name(name: str) -> str:
    s = html.unescape(name or "").lower()
    s = re.sub(r"[«»\"'„“”`()]", " ", s).replace("–", "-").replace("—", "-").replace("№", " ")
    for w in OPF:
        s = re.sub(rf"\b{re.escape(w)}\b", " ", s)
    s = re.sub(r"[^a-zа-яё0-9\- ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return ALIASES.get(s, s)


def _action(text_: str | None) -> str:
    t = (text_ or "").lower()
    if "отозв" in t or "отзыв" in t or "withdraw" in t:
        return "withdrawn"
    if "повыш" in t or "upgrade" in t:
        return "upgraded"
    if "пониж" in t or "downgrade" in t:
        return "downgraded"
    if "подтверж" in t or "affirm" in t:
        return "affirmed"
    if "присво" in t or "новый" in t or "new" in t:
        return "assigned"
    return "assigned"


class RatingSink:
    """Стыковка записей агентств с базой и запись в ref.credit_rating."""

    def __init__(self, run: LoadRun, agency: str) -> None:
        self.run = run
        self.agency_id = AGENCY[agency]
        self.scale = {r["grade"] for r in rows("select grade from ref.rating_scale")}
        self.by_isin = {r["isin"]: r["bond_id"] for r in rows("select isin, bond_id from ref.bond")}
        iss = rows("select issuer_id, name, inn, sector from ref.issuer")
        self.by_inn = {r["inn"]: r["issuer_id"] for r in iss if r["inn"]}
        self.by_name: dict[str, int] = {}
        for r in iss:
            self.by_name.setdefault(normalize_name(r["name"]), r["issuer_id"])
        self.names = list(self.by_name.items())
        self.skipped = 0
        self.loaded = 0

    def issuer_by_name(self, name: str) -> int | None:
        n = normalize_name(name)
        if not n:
            return None
        if n in self.by_name:
            return self.by_name[n]
        cands = [
            iid
            for k, iid in self.names
            if len(n) >= 5 and (n in k or k in n) and abs(len(k) - len(n)) <= 6
        ]
        return cands[0] if len(set(cands)) == 1 else None

    def add(
        self,
        *,
        grade_raw: str | None,
        assigned_on: date | None,
        isin: str | None = None,
        inn: str | None = None,
        name: str | None = None,
        outlook: str | None = None,
        action_text: str | None = None,
        withdrawn: bool = False,
        url: str | None = None,
        sector: str | None = None,
    ) -> None:
        grade = normalize_grade(grade_raw)
        if grade is None or grade not in self.scale or assigned_on is None:
            self.skipped += 1
            return
        bond_id = self.by_isin.get(isin) if isin else None
        issuer_id = None
        if bond_id is None:
            issuer_id = (self.by_inn.get(inn) if inn else None) or (
                self.issuer_by_name(name) if name else None
            )
        if bond_id is None and issuer_id is None:
            self.skipped += 1
            return
        action = "withdrawn" if withdrawn else _action(action_text)
        status = "withdrawn" if action == "withdrawn" else "active"
        try:
            with tx() as c:
                dup = c.execute(
                    text(
                        "select 1 from ref.credit_rating where agency_id = :a and grade = :g and assigned_on = :d "
                        "and coalesce(bond_id, 0) = coalesce(cast(:b as bigint), 0) "
                        "and coalesce(issuer_id, 0) = coalesce(cast(:i as bigint), 0)"
                    ),
                    {
                        "a": self.agency_id,
                        "g": grade,
                        "d": assigned_on,
                        "b": bond_id,
                        "i": issuer_id,
                    },
                ).first()
                if dup:  # повторная загрузка: запись уже есть
                    self.skipped += 1
                    return
                if status == "withdrawn":
                    c.execute(
                        text(
                            "update ref.credit_rating set status = 'superseded' where agency_id = :a and status = 'active' "
                            "and coalesce(bond_id, 0) = coalesce(cast(:b as bigint), 0) and coalesce(issuer_id, 0) = coalesce(cast(:i as bigint), 0)"
                        ),
                        {"a": self.agency_id, "b": bond_id, "i": issuer_id},
                    )
                c.execute(
                    text(
                        """
                        insert into ref.credit_rating (agency_id, issuer_id, bond_id, grade, outlook, action, assigned_on, status, source, source_url)
                        values (:a, :i, :b, :g, :o, cast(:act as ref.rating_action), :d, cast(:st as ref.rating_status), 'agency', :u)
                        """
                    ),
                    {
                        "a": self.agency_id,
                        "i": issuer_id,
                        "b": bond_id,
                        "g": grade,
                        "o": outlook,
                        "act": action,
                        "d": assigned_on,
                        "st": status,
                        "u": url,
                    },
                )
                if sector and issuer_id:
                    c.execute(
                        text(
                            "update ref.issuer set sector = :s where issuer_id = :i and sector = 'Прочее'"
                        ),
                        {"s": sector[:80], "i": issuer_id},
                    )
            self.loaded += 1
            self.run.ok += 1
        except Exception as e:  # noqa: BLE001
            self.run.error(
                f"rating insert failed: {str(e).splitlines()[0]}",
                {"isin": isin, "inn": inn, "name": name, "grade": grade},
            )


# ------------------------------------------------------------------ АКРА
ACRA_BODY = {
    "text": "",
    "sectors": [],
    "activities": [],
    "countries": [],
    "forecasts": [],
    "on_revision": 0,
    "rating_scale": 0,
    "rate_from": 0,
    "rate_to": 0,
    "page": 0,
    "sort": "",
    "count": 3000,
}


def _acra_fetch(endpoint: str, extra: dict[str, Any]) -> list[dict[str, Any]]:
    def fetch() -> bytes:
        # сертификат acra-ratings.ru не проходит проверку certifi → системный trust store через curl
        body = json.dumps({**ACRA_BODY, **extra})
        res = subprocess.run(
            [
                "curl",
                "-sS",
                "--max-time",
                "120",
                "-A",
                UA["User-Agent"],
                "-H",
                "Content-Type: application/json",
                "-H",
                "X-Requested-With: XMLHttpRequest",
                "-X",
                "POST",
                "--data",
                body,
                f"https://www.acra-ratings.ru/local/ajax/{endpoint}",
            ],
            capture_output=True,
            check=True,
        )
        json.loads(res.stdout)  # ответ WAF (403, HTML) не должен попасть в кэш как данные
        return res.stdout

    data = json.loads(_cached(f"acra_{endpoint}.json", fetch))
    return [i for i in data["data"]["items"] if i.get("type") == "row"]


def load_acra(run: LoadRun) -> RatingSink:
    sink = RatingSink(run, "ACRA")
    for item in _acra_fetch("get_rate_person.php", {}) + _acra_fetch(
        "get_rate_emission.php", {"vexel_types": "", "issue_type": "", "debt_types": ""}
    ):
        info = item["info"][0] if isinstance(item.get("info"), list) else item["info"]
        rate = info["rate"]["value"]
        pr = (info.get("pressRelease") or {}).get("value") or {}
        em = (info.get("emission") or {}).get("value") or {}
        if not (em.get("isin") or em.get("id")):
            em = {}
        ts = pr.get("timestamp")
        sink.add(
            grade_raw=rate.get("title"),
            assigned_on=datetime.fromtimestamp(ts).date() if ts else None,
            isin=em.get("isin"),
            name=html.unescape(info["ratePerson"]["value"]["title"]) if not em else None,
            outlook=rate.get("forecast") or None,
            action_text=rate.get("action_name"),
            withdrawn=bool(rate.get("is_withdrawn")),
            url=("https://www.acra-ratings.ru" + pr["url"]) if pr.get("url") else None,
            sector=((info.get("sector") or {}).get("value") or {}).get("title"),
        )
    return sink


# ------------------------------------------------------------------ НКР
def _html_rows(page: str) -> list[list[str]]:
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
            for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)
        ]
        if cells:
            out.append(cells)
    return out


def _ru_date(s: str) -> date | None:
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", s or "")
    return date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def load_nkr(run: LoadRun) -> RatingSink:
    sink = RatingSink(run, "NKR")
    for kind in ("issuers", "issues"):
        page = html.unescape(
            _cached(
                f"nkr_{kind}.html",
                lambda kind=kind: (
                    httpx.get(
                        f"https://ratings.ru/ratings/{kind}/",
                        headers=UA,
                        timeout=60,
                        follow_redirects=True,
                    ).content
                ),
            ).decode("utf-8", "ignore")
        )
        for cells in _html_rows(page):
            if kind == "issuers" and len(cells) >= 5:
                name, grade = cells[0], cells[1]
                outlook = cells[2] if len(cells) > 2 else None
                sector = cells[-2] if len(cells) >= 5 else None
                sink.add(
                    grade_raw=grade,
                    assigned_on=_ru_date(cells[-1]),
                    name=name,
                    outlook=outlook,
                    action_text=None,
                    sector=sector,
                )
            elif kind == "issues" and len(cells) >= 5:
                isin = next((c for c in cells if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}\d", c)), None)
                sink.add(
                    grade_raw=cells[2],
                    assigned_on=_ru_date(cells[-1]),
                    isin=isin,
                    name=cells[0] if not isin else None,
                )
    return sink


# ------------------------------------------------------------------ НРА
def _xlsx_rows(data: bytes) -> list[dict[str, str]]:
    z = zipfile.ZipFile(BytesIO(data))
    ss = [
        re.sub(r"<[^>]+>", "", x)
        for x in re.findall(
            r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf-8", "ignore"), re.S
        )
    ]
    ws = [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")][0]
    xml = z.read(ws).decode("utf-8", "ignore")
    parsed = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        cells = {}
        for ref, t, v in re.findall(
            r'<c r="([A-Z]+)\d+"(?: s="\d+")?(?: t="(\w+)")?>(?:<v>([^<]*)</v>)?', row
        ):
            cells[ref] = html.unescape(ss[int(v)]) if t == "s" and v else v
        parsed.append(cells)
    hdr = parsed[0]
    return [{hdr.get(k, k): v for k, v in r.items()} for r in parsed[1:]]


def load_nra(run: LoadRun) -> RatingSink:
    sink = RatingSink(run, "NRA")

    def fetch() -> bytes:
        page = httpx.get(
            "https://www.ra-national.ru/ratings/", headers=UA, timeout=60, follow_redirects=True
        ).text
        m = re.search(r'href="([^"]*wp-load\.php\?[^"]*export_id=20[^"]*)"', page)
        if not m:
            raise RuntimeError("NRA export link not found")
        url = html.unescape(m.group(1))
        r = httpx.get(url, headers=UA, timeout=180, follow_redirects=True)
        r.raise_for_status()
        return r.content

    recs = _xlsx_rows(_cached("nra_export.xlsx", fetch))
    recs = [r for r in recs if (r.get("Вид рейтинга") or "").lower().startswith("кредитный")]
    recs.sort(key=lambda r: _ru_date(r.get("Дата опубликования пресс-релиза") or "") or date.min)
    for r in recs:
        inn = r.get("ИНН")
        inn = str(int(float(inn))) if inn and re.fullmatch(r"[\d.E+]+", str(inn)) else (inn or None)
        if inn and len(inn) == 9:
            inn = "0" + inn
        sink.add(
            grade_raw=r.get("Рейтинг"),
            assigned_on=_ru_date(r.get("Дата опубликования пресс-релиза") or ""),
            isin=(r.get("ISIN") or None) if (r.get("ISIN") or "").startswith("RU") else None,
            inn=inn,
            name=r.get("Название организации"),
            outlook=r.get("Прогноз") or None,
            action_text=r.get("Статус рейтинга"),
            withdrawn=(r.get("Статус рейтинга") or "").lower().startswith("отозв"),
            url=r.get("Ссылка на пресс релиз") or None,
            sector=r.get("Отрасль") or r.get("Сектор организации"),
        )
    return sink


LOADERS = {"acra": load_acra, "nkr": load_nkr, "nra": load_nra}


def load_ratings(agency: str = "all") -> None:
    """Только публичные рейтинги агентств: бумаги без рейтинга остаются без рейтинга (бакет ADV01 «без рейтинга»)."""
    for code in LOADERS if agency == "all" else [agency]:
        run = LoadRun(f"load ratings {code}")
        try:
            sink = LOADERS[code](run)
            log.info(
                "%s: loaded %d, skipped (no match / not in scale) %d",
                code,
                sink.loaded,
                sink.skipped,
            )
        except Exception as e:  # noqa: BLE001
            run.error(f"{code} failed: {e}")
        run.finish()
    cov = rows(
        "select count(*) filter (where r.source <> 'none') as rated, count(*) as total "
        "from ref.bond b cross join lateral risk.canonical_rating(b.bond_id) r"
    )[0]
    log.info(
        "coverage: %d of %d bonds have a rating (issue, issuer or sovereign)",
        cov["rated"],
        cov["total"],
    )
