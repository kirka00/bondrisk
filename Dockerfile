FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /uvx /bin/
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY db ./db
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "bondrisk.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
