"""Alembic: миграции выполняются под административным подключением (DDL), SQL лежит в db/*.sql."""

from alembic import context
from sqlalchemy import create_engine

from bondrisk.settings import get_settings


def run_migrations_online() -> None:
    engine = create_engine(str(get_settings().admin_database_url))
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=None, transaction_per_migration=True
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
