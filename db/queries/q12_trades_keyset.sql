-- q12. Блоттер сделок с keyset-пагинацией (стабильна при вставках, использует индекс
-- trade_portfolio_ts_idx (portfolio_id, trade_ts desc, trade_id desc)); в API применяется offset-вариант.
-- Конструкции: сравнение кортежей (row-value comparison), LIMIT, представление ops.v_trade_blotter.
-- Параметры: :portfolio_id, :cursor_ts (NULL — первая страница), :cursor_id, :limit
select trade_id, trade_ts, trade_date, settlement_date, side, qty, clean_price_pct, accrued_interest, amount, fee,
       isin, short_name, issuer_name, currency, counterparty, status, created_by_login
  from ops.v_trade_blotter
 where portfolio_id = :portfolio_id
   and (cast(:cursor_ts as timestamptz) is null
        or (trade_ts, trade_id) < (cast(:cursor_ts as timestamptz), cast(:cursor_id as bigint)))
 order by trade_ts desc, trade_id desc
 limit :limit;
