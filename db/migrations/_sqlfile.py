"""Выполнение SQL-файлов из db/ внутри миграций."""

from pathlib import Path

from alembic import op

DB_DIR = Path(__file__).resolve().parents[1]


def run_sql(relative: str, check_bodies: bool = False, optional: bool = False) -> None:
    """optional — выполнить в точке сохранения и пропустить при ошибке: ранние миграции выполняют текущий
    файл представлений, который может ссылаться на колонки более поздних миграций (их пересоздаёт 0012)."""
    sql = (DB_DIR / relative).read_text(encoding="utf-8")
    if relative.startswith("functions/") and not check_bodies:
        # ранние миграции выполняют текущие файлы функций, а таблицы, на которые ссылаются тела
        # новых версий, появляются позже (0012): тела проверяются при вызове, а не при создании
        sql = "set local check_function_bodies = off;\n" + sql
    if not optional:
        op.execute(sql)
        return
    bind = op.get_bind()
    try:
        with bind.begin_nested():
            bind.exec_driver_sql(sql)
    except Exception as e:  # noqa: BLE001
        print(f"  {relative}: пропущено до более поздней миграции ({str(e).splitlines()[0][:120]})")
