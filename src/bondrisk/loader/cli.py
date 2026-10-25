"""CLI загрузчика: `uv run bondrisk <команда>`. Пока — проверка связи с БД и MOEX."""

import typer

from bondrisk.db.engine import db_version
from bondrisk.loader.moex import MoexClient

app = typer.Typer(help="Загрузка справочников и временных рядов в bondrisk")


@app.command()
def check() -> None:
    """Проверить подключение к БД и доступность MOEX ISS."""
    typer.echo(db_version())
    bonds = MoexClient().board_bonds("TQOB")
    typer.echo(
        f"MOEX TQOB: {len(bonds)} выпусков, первый — {bonds[0]['SECID']} {bonds[0]['SHORTNAME']}"
    )


@app.command()
def bonds(board: str = "TQOB") -> None:
    """Список выпусков режима торгов (пока только печать, загрузка в БД — неделя 2)."""
    for b in MoexClient().board_bonds(board):
        typer.echo(
            f"{b['SECID']}\t{b['ISIN']}\t{b['SHORTNAME']}\t{b['MATDATE']}\t{b['COUPONPERCENT']}"
        )


if __name__ == "__main__":
    app()
