"""Pydantic-схемы запросов и ответов REST API (контракт docs/api-contract.md)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Num = float | Decimal | None


class Page(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class ErrorOut(BaseModel):
    detail: str
    code: str | None = None
    retryable: bool | None = None


# ---------- справочники ----------
class IssuerIn(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "ПАО «Газпром нефть»",
                "short_name": "Газпром нефть",
                "inn": "5504036333",
                "sector": "Нефть и газ",
                "country": "RU",
                "is_sovereign": False,
            }
        }
    )
    name: str = Field(min_length=2, max_length=300)
    short_name: str | None = None
    inn: str | None = Field(default=None, pattern=r"^\d{10}(\d{2})?$")
    sector: str = "Прочее"
    country: str = Field(default="RU", min_length=2, max_length=2)
    is_sovereign: bool = False
    moex_emitter_id: int | None = None


class IssuerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=300)
    short_name: str | None = None
    inn: str | None = Field(default=None, pattern=r"^\d{10}(\d{2})?$")
    sector: str | None = None
    country: str | None = Field(default=None, min_length=2, max_length=2)
    is_sovereign: bool | None = None


CouponType = Literal["fixed", "floating", "zero"]
BondStatus = Literal["trading", "matured", "defaulted", "suspended"]


class BondIn(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "isin": "RU000A1038V6",
                "secid": "SU26238RMFS4",
                "issuer_id": 1,
                "short_name": "ОФЗ 26238",
                "currency": "RUB",
                "face_value_initial": 1000,
                "coupon_type": "fixed",
                "coupon_rate_pct": 7.1,
                "coupon_freq": 2,
                "issue_date": "2021-06-16",
                "maturity_date": "2041-05-15",
                "board": "TQOB",
            }
        }
    )
    isin: str = Field(pattern=r"^[A-Z]{2}[A-Z0-9]{9}\d$")
    secid: str = Field(min_length=3, max_length=40)
    issuer_id: int
    short_name: str
    full_name: str | None = None
    currency: str = Field(default="RUB", min_length=3, max_length=3)
    face_value_initial: Decimal = Field(gt=0)
    coupon_type: CouponType = "fixed"
    coupon_rate_pct: Decimal | None = Field(default=None, ge=0)
    coupon_freq: int = Field(default=2, ge=0, le=12)
    issue_date: date | None = None
    maturity_date: date
    offer_date: date | None = None
    is_amortizing: bool = False
    board: str = "TQCB"
    list_level: int | None = Field(default=None, ge=1, le=3)
    status: BondStatus = "trading"


class BondPatch(BaseModel):
    short_name: str | None = None
    full_name: str | None = None
    coupon_type: CouponType | None = None
    coupon_rate_pct: Decimal | None = Field(default=None, ge=0)
    coupon_freq: int | None = Field(default=None, ge=0, le=12)
    maturity_date: date | None = None
    offer_date: date | None = None
    is_amortizing: bool | None = None
    board: str | None = None
    list_level: int | None = Field(default=None, ge=1, le=3)
    status: BondStatus | None = None


# ---------- портфели ----------
class PortfolioIn(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "code": "OFZ-CORE",
                "name": "ОФЗ консервативный",
                "base_currency": "RUB",
                "manager_id": 2,
                "allow_short": False,
            }
        }
    )
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2)
    base_currency: str = Field(default="RUB", min_length=3, max_length=3)
    manager_id: int
    allow_short: bool = False


class PortfolioPatch(BaseModel):
    name: str | None = None
    manager_id: int | None = None
    allow_short: bool | None = None
    status: Literal["active", "closed"] | None = None


class DepositIn(BaseModel):
    currency: str = Field(default="RUB", min_length=3, max_length=3)
    amount: Decimal
    note: str | None = None


# ---------- сделки ----------
Side = Literal["buy", "sell"]


class TradePreviewIn(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"bond_id": 1, "side": "buy", "qty": 1000, "settlement_days": 1}
        }
    )
    bond_id: int
    side: Side
    qty: int = Field(gt=0)
    as_of: date | None = None
    # §20: цена сделки (по умолчанию — рыночная) и дата расчётов: T+0/1/2 или ручная дата
    clean_price_pct: float | None = Field(default=None, gt=0)
    settlement_days: int = Field(default=1, ge=0, le=2)
    settlement_date: date | None = None


class PriceOverrideIn(BaseModel):
    bond_id: int
    as_of: date
    clean_price_pct: Decimal | None = Field(default=None, gt=0)
    accrued_interest: Decimal | None = Field(default=None, ge=0)
    face_value: Decimal | None = Field(default=None, gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class CashAdjustmentIn(BaseModel):
    currency: Literal["RUB", "USD", "EUR", "CNY", "GBP"]
    as_of: date | None = None
    target_balance: Decimal | None = None
    shift: Decimal | None = None
    reason: str = Field(min_length=3, max_length=1000)


class SynonymIn(BaseModel):
    kind: Literal["issuer", "sector"]
    alias: str = Field(min_length=1, max_length=300)
    canonical: str = Field(min_length=1, max_length=300)


class TradeIn(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "bond_id": 1,
                "side": "buy",
                "qty": 1000,
                "clean_price_pct": 98.5,
                "fee": 150,
                "counterparty": "Брокер А",
            }
        }
    )
    bond_id: int
    side: Side
    qty: int = Field(gt=0)
    clean_price_pct: Decimal = Field(gt=0)
    trade_date: date | None = None
    settlement_days: int = Field(default=1, ge=0, le=10)
    fee: Decimal = Field(default=Decimal(0), ge=0)
    counterparty: str | None = None
    check_limits: bool = True


# ---------- лимиты ----------
LimitMetric = Literal[
    "dv01",
    "duration",
    "var_99",
    "mv_gross",
    "conc_issuer",
    "conc_sector",
    "conc_issue",
    "short_mv",
    "below_aaa_mv",
    "fx_mv",
    "conc_portfolio",
    "credit_spread",
    "new_issuer_rating",
]
LimitSide = Literal["long", "short", "both"]


class LimitIn(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "portfolio_id": 1,
                "metric": "dv01",
                "threshold_abs": 500000,
                "warning_pct": 80,
                "is_hard": True,
            }
        }
    )
    portfolio_id: int
    metric: LimitMetric
    scope_issuer_id: int | None = None
    scope_bond_id: int | None = None
    scope_sector: str | None = None
    side: LimitSide = "both"
    threshold_abs: Decimal | None = None
    threshold_pct: Decimal | None = None
    warning_pct: Decimal = Field(default=Decimal(80), gt=0, lt=100)
    is_hard: bool = True
    valid_from: date | None = None
    valid_to: date | None = None
    # книга лимитной политики (§16.2)
    basis: Literal["cost", "market", "max"] = "cost"
    pct_base: Literal["gross", "total_limit"] = "gross"
    emission_share_pct: Decimal | None = Field(default=None, gt=0, le=100)
    scope_name: str | None = None
    committee: Literal["IC", "RC"] | None = None
    self_adjust_pct: Decimal | None = Field(default=None, gt=0)
    min_grade: str | None = None


class LimitPatch(BaseModel):
    threshold_abs: Decimal | None = None
    threshold_pct: Decimal | None = None
    warning_pct: Decimal | None = Field(default=None, gt=0, lt=100)
    is_hard: bool | None = None
    side: LimitSide | None = None
    valid_to: date | None = None
    basis: Literal["cost", "market", "max"] | None = None
    pct_base: Literal["gross", "total_limit"] | None = None
    emission_share_pct: Decimal | None = Field(default=None, gt=0, le=100)
    min_grade: str | None = None


class WaiveIn(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"reason": "Согласовано ИК 25.10, позиция сокращается до 01.11"}
        }
    )
    reason: str = Field(min_length=5, max_length=1000)


class Health(BaseModel):
    status: str
    version: str
    postgres: str
    timescaledb: str
    alembic_revision: str | None = None
    time: datetime
