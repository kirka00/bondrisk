FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /uvx /bin/
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsS http://secure.globalsign.com/cacert/gsgccr46ovtlsca2025.crt \
       | openssl x509 -inform der -out /usr/local/share/ca-certificates/globalsign-gcc-r46-ov-2025.crt \
    && update-ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY db ./db
COPY alembic.ini ./
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "bondrisk.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
