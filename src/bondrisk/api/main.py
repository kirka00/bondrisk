from fastapi import FastAPI

from bondrisk import __version__
from bondrisk.db.engine import db_version

app = FastAPI(
    title="bondrisk",
    version=__version__,
    description="Система управления портфелями облигаций и аналитики процентных и кредитных рисков",
)


@app.get("/health", tags=["service"])
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__, **db_version()}
