import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Сделки неизменяемы и через API не удаляются, поэтому сделки, проведённые тестами (06-trade), откатываются
 * административным SQL в контейнере БД: касса и движения, позиция, затем сама сделка при отключённом
 * триггере неизменяемости — одной транзакцией. Без Docker прогон не падает, а предупреждает.
 */
export default function globalTeardown() {
  const mark = join(import.meta.dirname, '.run-started')
  if (!existsSync(mark)) return
  const since = readFileSync(mark, 'utf8').trim()
  rmSync(mark)
  const sql = `
begin;
create temp table e2e on commit drop as
  select trade_id, portfolio_id, bond_id, side, qty, clean_price_pct from ops.trade
   where created_at >= '${since}'::timestamptz and counterparty is null;
update ops.cash_account ca set balance = balance - s.amt
  from (select cash_account_id, sum(amount) amt from ops.cash_movement where trade_id in (select trade_id from e2e) group by 1) s
 where ca.cash_account_id = s.cash_account_id;
delete from ops.cash_movement where trade_id in (select trade_id from e2e);
update ops.position x set qty = x.qty - d.dq,
       cost_basis = case when x.qty - d.dq = 0 then 0 else x.cost_basis - d.cost end,
       avg_clean_price_pct = case when x.qty - d.dq = 0 then null else x.avg_clean_price_pct end
  from (select e.portfolio_id, e.bond_id, sum(case when e.side = 'buy' then e.qty else -e.qty end) dq,
               sum(case when e.side = 'buy' then e.qty * e.clean_price_pct / 100.0 * ref.face_value_at(e.bond_id, current_date) else 0 end) cost
          from e2e e group by 1, 2) d
 where x.portfolio_id = d.portfolio_id and x.bond_id = d.bond_id;
alter table ops.trade disable trigger trade_immutable;
delete from ops.trade where trade_id in (select trade_id from e2e);
alter table ops.trade enable trigger trade_immutable;
commit;`
  try {
    execFileSync('docker', ['exec', '-i', 'bondrisk-db', 'psql', '-U', 'postgres', '-d', 'bondrisk', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'ignore', 'pipe'] })
  } catch (e) {
    console.warn(`[e2e teardown] не удалось откатить тестовые сделки: ${(e as Error).message}`)
  }
}
