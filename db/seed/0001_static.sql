-- Статические справочники: агентства, шкала, стресс-сценарии, служебные пользователи.
insert into ref.rating_agency (agency_id, code, name, priority) values
    (1, 'EXPERT_RA', 'Эксперт РА', 1),
    (2, 'ACRA',      'АКРА',       2),
    (3, 'NKR',       'НКР',        3),
    (4, 'NRA',       'НРА',        4)
on conflict (agency_id) do nothing;

-- Каноническая шкала: балл AAA = 1 … D = 22; бакеты и коэффициенты ADV01 — методология §14
insert into ref.rating_scale (grade, score, adv01_bucket, adv01_coef) values
    ('AAA', 1, 'AAA', 0.90),
    ('AA+', 2, 'AA', 1.00), ('AA', 3, 'AA', 1.00), ('AA-', 4, 'AA', 1.00),
    ('A+',  5, 'A',  1.10), ('A',  6, 'A',  1.10), ('A-',  7, 'A',  1.10),
    ('BBB+', 8, 'BBB', 1.25), ('BBB', 9, 'BBB', 1.25), ('BBB-', 10, 'BBB', 1.25),
    ('BB+', 11, 'BB', 1.50), ('BB', 12, 'BB', 1.50),
    ('BB-', 13, 'B', 1.75), ('B+', 14, 'B', 1.75), ('B', 15, 'B', 1.75), ('B-', 16, 'B', 1.75),
    ('CCC', 17, 'CCC', 2.00), ('CC', 18, 'CCC', 2.00), ('C', 19, 'CCC', 2.00),
    ('NR', 20, 'NR', 3.00),
    ('SD', 21, 'D', 5.00), ('D', 22, 'D', 5.00)
on conflict (grade) do nothing;

insert into risk.stress_scenario (code, name, kind, shift_bp, pivot_years, amplitude_bp, fx_currency, fx_change_pct) values
    ('P-50',  'Параллельный сдвиг −50 б.п.',  'parallel', -50,  null, null, null, null),
    ('P+50',  'Параллельный сдвиг +50 б.п.',  'parallel',  50,  null, null, null, null),
    ('P-100', 'Параллельный сдвиг −100 б.п.', 'parallel', -100, null, null, null, null),
    ('P+100', 'Параллельный сдвиг +100 б.п.', 'parallel',  100, null, null, null, null),
    ('P+200', 'Параллельный сдвиг +200 б.п.', 'parallel',  200, null, null, null, null),
    ('P+300', 'Параллельный сдвиг +300 б.п.', 'parallel',  300, null, null, null, null),
    ('STEEP', 'Steepener: твист 25 б.п., точка 5 лет', 'twist', null, 5, 25, null, null),
    ('FLAT',  'Flattener: твист 25 б.п., точка 5 лет', 'twist', null, 5, -25, null, null),
    ('CNY-10', 'Юань −10 % к рублю', 'fx', null, null, null, 'CNY', -10),
    ('USD+20', 'Доллар +20 % к рублю', 'fx', null, null, null, 'USD', 20)
on conflict (code) do nothing;

insert into ops.app_user (login, full_name, role) values
    ('admin',  'Администратор системы', 'admin'),
    ('trader', 'Иванов Пётр (трейдер)', 'trader'),
    ('risk',   'Смирнова Анна (риск-менеджер)', 'risk_manager'),
    ('viewer', 'Наблюдатель', 'viewer')
on conflict (login) do nothing;
