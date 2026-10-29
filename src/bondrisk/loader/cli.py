"""CLI загрузчика: `uv run bondrisk <группа> <команда>`."""

from __future__ import annotations

import logging
import subprocess
import sys
from datetime import date

import typer

from bondrisk.db.engine import db_version


def _d(v: str | None) -> date:
    return date.fromisoformat(v) if v else date.today()


app = typer.Typer(
    help="Загрузка справочников, временных рядов и портфелей bondrisk", no_args_is_help=True
)
load_app = typer.Typer(help="Загрузка данных из внешних источников", no_args_is_help=True)
app.add_typer(load_app, name="load")
SECID_OPT = typer.Option(None, "--secid")


@app.callback()
def _setup(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)


@app.command()
def check() -> None:
    """Проверить подключение к БД и доступность MOEX ISS."""
    from bondrisk.loader.moex import MoexClient

    typer.echo(db_version())
    bonds = MoexClient().board_bonds("TQOB")
    typer.echo(
        f"MOEX TQOB: {len(bonds)} выпусков, первый — {bonds[0]['SECID']} {bonds[0]['SHORTNAME']}"
    )


@app.command()
def migrate(to: str = "head") -> None:
    """Применить миграции Alembic (админ-подключение)."""
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", to], check=True)


@load_app.command("bonds")
def load_bonds_cmd(boards: str = "TQOB,TQCB", max_corporate: int = 300) -> None:
    """Эмитенты и выпуски: все ОФЗ + ликвидные корпоративные."""
    from bondrisk.loader.bonds import load_bonds

    load_bonds(boards.split(","), max_corporate)


@load_app.command("schedules")
def load_schedules_cmd(secid: list[str] = SECID_OPT) -> None:
    """Графики купонов, амортизаций и оферт; определение флоутеров."""
    from bondrisk.loader.bonds import load_schedules

    load_schedules(secid or None)


@load_app.command("prices")
def load_prices_cmd(
    date_from: str = typer.Option("2022-01-01", "--from"),
    date_to: str = typer.Option(None, "--to"),
    secid: list[str] = SECID_OPT,
    workers: int = 4,
) -> None:
    """История цен закрытия (MOEX) → ts.price_history."""
    from bondrisk.loader.market import load_prices

    load_prices(_d(date_from), _d(date_to), secid or None, workers)


@load_app.command("curve")
def load_curve_cmd(
    date_from: str = typer.Option("2022-01-01", "--from"),
    date_to: str = typer.Option(None, "--to"),
) -> None:
    """Кривая бескупонной доходности MOEX → ts.yield_curve."""
    from bondrisk.loader.market import load_curve

    load_curve(_d(date_from), _d(date_to))


@load_app.command("fx")
def load_fx_cmd(
    date_from: str = typer.Option("2022-01-01", "--from"),
    date_to: str = typer.Option(None, "--to"),
) -> None:
    """Курсы ЦБ РФ (USD, EUR, CNY) → ts.fx_rate."""
    from bondrisk.loader.market import load_fx

    load_fx(_d(date_from), _d(date_to))


@load_app.command("ratings")
def load_ratings_cmd(agency: str = "all") -> None:
    """Публичные рейтинги АКРА/НКР/НРА."""
    from bondrisk.loader.ratings import load_ratings

    load_ratings(agency)


@load_app.command("funds")
def load_funds_cmd(as_of: str = typer.Option(None, "--as-of")) -> None:
    """Реальный портфель БПИФ BOND (ДОХОДЪ) по опубликованному составу фонда."""
    from bondrisk.loader.funds import load_funds

    load_funds(_d(as_of))


@load_app.command("index-history")
def load_index_history_cmd(
    code: str = typer.Option(None, "--code", help="RGBI | RUCB | RUHY | RUCNY; без кода — все"),
    date_from: str = typer.Option("2024-11-01", "--from"),
    date_to: str = typer.Option(None, "--to"),
) -> None:
    """Портфели-репликанты индексов MOEX: исторические составы, ежемесячная ребалансировка, ежедневный EOD."""
    from bondrisk.loader.db import rows
    from bondrisk.loader.funds import INDEXES
    from bondrisk.loader.index_history import build_index_history

    last = rows("select max(ts) as d from ts.yield_curve")[0]["d"]
    for c in [code] if code else list(INDEXES):
        build_index_history(c, _d(date_from), _d(date_to) if date_to else last)


@load_app.command("indexes")
def load_indexes_cmd(
    date_from: str = typer.Option("2014-01-01", "--from"),
    date_to: str = typer.Option(None, "--to"),
) -> None:
    """Индексы MOEX RGBITR, IMOEX и ставка RUSFAR CNY → ts.index_value."""
    from bondrisk.loader.indexes import load_indexes

    load_indexes(_d(date_from), _d(date_to))


@load_app.command("scenarios")
def load_scenarios_cmd() -> None:
    """Исторические стресс-сценарии (§13): кризисные эпизоды × горизонты по курсам ЦБ и индексам MOEX."""
    from bondrisk.loader.indexes import build_historical_scenarios

    typer.echo(f"scenarios: {build_historical_scenarios()}")


@load_app.command("all")
def load_all_cmd(
    date_from: str = typer.Option("2022-01-01", "--from"),
    max_corporate: int = 300,
) -> None:
    """Справочники и рынок: bonds → schedules → prices → curve → fx → индексы и сценарии → ratings."""
    from bondrisk.loader.bonds import load_bonds, load_schedules
    from bondrisk.loader.indexes import build_historical_scenarios, load_indexes
    from bondrisk.loader.market import load_curve, load_fx, load_prices
    from bondrisk.loader.ratings import load_ratings

    today = date.today()
    load_bonds(["TQOB", "TQCB"], max_corporate)
    load_schedules()
    load_prices(_d(date_from), today)
    load_curve(_d(date_from), today)
    # курсы и индексы — с 2014 г.: исторические стресс-сценарии начинаются с рублёвого кризиса 2014
    load_fx(min(_d(date_from), date(2014, 1, 1)), today)
    load_indexes(date(2014, 1, 1), today)
    build_historical_scenarios()
    load_ratings("all")


@app.command()
def update(
    reference: bool = typer.Option(
        False, "--reference", help="ещё справочник выпусков и графики платежей (раз в неделю)"
    ),
) -> None:
    """Догрузить рынок и рейтинги с последней даты в базе, EOD и ребалансировки по новым дням."""
    from bondrisk.loader.update import update as run_update

    for k, v in run_update(reference).items():
        typer.echo(f"{k}: {v}")


@app.command()
def scheduler(
    daily: str = typer.Option("21:00,07:30", help="время запусков по Москве, через запятую"),
    reference_day: int = typer.Option(6, help="день недели справочника: 0 — пн … 6 — вс"),
) -> None:
    """Расписание автообновления (сервис scheduler в docker compose): сразу догоняет пропущенное."""
    from bondrisk.loader.scheduler import run_forever

    run_forever([t.strip() for t in daily.split(",")], reference_day)


@app.command()
def eod(
    portfolio: str = typer.Option(None, "--portfolio"),
    all_: bool = typer.Option(False, "--all"),
    as_of: str = typer.Option(None, "--as-of"),
) -> None:
    """Снапшот риска и контроль лимитов на дату."""
    from bondrisk.loader.eod import run_eod

    if not portfolio and not all_:
        raise typer.BadParameter("укажите --portfolio CODE или --all")
    run_eod(portfolio, _d(as_of))


@app.command("eod-range")
def eod_range(
    portfolio: str = typer.Option(None, "--portfolio"),
    all_: bool = typer.Option(False, "--all"),
    date_from: str = typer.Option(..., "--from"),
    date_to: str = typer.Option(None, "--to"),
    holdings: str = typer.Option(
        None, "--holdings", help="про-форма: состав на эту дату, рынок на каждый день периода"
    ),
) -> None:
    """EOD по всем торговым дням периода (с --holdings — ретроспектива текущего состава)."""
    from bondrisk.loader.eod import run_eod_range

    if not portfolio and not all_:
        raise typer.BadParameter("укажите --portfolio CODE или --all")
    n = run_eod_range(portfolio, _d(date_from), _d(date_to), _d(holdings) if holdings else None)
    typer.echo(f"eod runs: {n}")


if __name__ == "__main__":
    app()
