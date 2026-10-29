#!/bin/sh
# Пароль app_rw из окружения (прод, docker-compose.prod.yml); без переменной остаётся учебный
# 'app_rw' из 00_extensions.sql. Выполняется один раз — при инициализации пустого тома.
if [ -n "${APP_RW_PASSWORD:-}" ]; then
	psql -v ON_ERROR_STOP=1 -v pw="$APP_RW_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
alter role app_rw password :'pw';
SQL
fi
