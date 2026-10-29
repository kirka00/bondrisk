"""Планировщик автообновления: без внешних зависимостей, время — московское (UTC+3, без перехода)."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from bondrisk.loader.db import scalar
from bondrisk.loader.update import update

log = logging.getLogger("bondrisk.scheduler")
MSK = timezone(timedelta(hours=3))
REFERENCE_EVERY = timedelta(days=7)


def next_run(now: datetime, times: list[str]) -> datetime:
    """Ближайший момент из ежедневного списка «ЧЧ:ММ» строго после now."""
    cands = []
    for t in times:
        h, m = map(int, t.split(":"))
        at = now.replace(hour=h, minute=m, second=0, microsecond=0)
        cands.append(at if at > now else at + timedelta(days=1))
    return min(cands)


def _reference_due(now: datetime, reference_day: int) -> bool:
    """Справочник раз в неделю в заданный день; пропущенный (контейнер был выключен) — при первом запуске."""
    last = scalar(
        "select max(finished_at) from stg.load_run where source = 'load bonds' and finished_at is not null"
    )
    return (
        last is None
        or now - last >= REFERENCE_EVERY
        or (now.weekday() == reference_day and last.astimezone(MSK).date() < now.date())
    )


def _run(reference_day: int) -> None:
    now = datetime.now(MSK)
    try:
        dates = update(reference=_reference_due(now, reference_day))
        log.info("update done: %s", dates)
    except Exception:  # noqa: BLE001 — следующий запуск догонит
        log.exception("update failed")


def run_forever(times: list[str], reference_day: int) -> None:
    log.info("scheduler: daily %s MSK, reference on weekday %d", ",".join(times), reference_day)
    _run(reference_day)  # после простоя данные догоняются сразу
    while True:
        at = next_run(datetime.now(MSK), times)
        log.info("next update at %s", at.isoformat(timespec="minutes"))
        while (left := (at - datetime.now(MSK)).total_seconds()) > 0:
            time.sleep(min(left, 300))
        _run(reference_day)
