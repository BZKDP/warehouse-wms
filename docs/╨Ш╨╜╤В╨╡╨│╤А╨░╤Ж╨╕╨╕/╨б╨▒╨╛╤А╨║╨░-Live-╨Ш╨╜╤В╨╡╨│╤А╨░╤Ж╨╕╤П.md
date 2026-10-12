# Интеграция сборки заказов с Live-мониторингом GRAсклад

## Суть
Оба сайта (GRAсклад и сайт сборки) работают с одной PostgreSQL БД. Сайт сборки записывает каждый пик в таблицу, GRAсклад читает и показывает в Live-мониторинге.

## Шаг 1: Создать таблицу

Выполнить в PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS sborka_live_events_s (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,       -- ID сотрудника из employees_s
  event_type VARCHAR(50) NOT NULL,    -- 'pick' | 'order_start' | 'order_complete'
  order_id VARCHAR(255),              -- Номер заказа (WB-123456, OZON-789)
  product_name TEXT,                  -- Название товара (для отображения)
  barcode VARCHAR(255),               -- Штрих-код товара
  quantity INTEGER DEFAULT 1,         -- Количество (обычно 1)
  marketplace VARCHAR(50),            -- 'wb' | 'ozon' | 'yandex' | 'sber'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sborka_live_employee ON sborka_live_events_s (employee_id, created_at DESC);
CREATE INDEX idx_sborka_live_created ON sborka_live_events_s (created_at DESC);
```

## Шаг 2: Что писать в таблицу (сайт сборки)

### При сканировании товара (каждый пик):
```sql
INSERT INTO sborka_live_events_s (employee_id, event_type, order_id, product_name, barcode, quantity, marketplace)
VALUES (42, 'pick', 'WB-123456', 'GraFLab NMN 60 капсул', '4627174095128', 1, 'wb');
```

### При начале сборки заказа:
```sql
INSERT INTO sborka_live_events_s (employee_id, event_type, order_id, marketplace)
VALUES (42, 'order_start', 'WB-123456', 'wb');
```

### При завершении сборки заказа:
```sql
INSERT INTO sborka_live_events_s (employee_id, event_type, order_id, marketplace)
VALUES (42, 'order_complete', 'WB-123456', 'wb');
```

## Шаг 3: Как найти employee_id

Сотрудники хранятся в таблице `employees_s`:

```sql
SELECT id, full_name, position FROM employees_s WHERE active = true;
```

Результат:
| id | full_name | position |
|----|-----------|----------|
| 42 | Шатилова Дарья Борисовна | Упаковщик |
| 43 | Плешкова Татьяна Витальевна | Упаковщик |
| ... | ... | ... |

Используй `id` как `employee_id` при записи.

## Шаг 4: Что GRAсклад будет читать

GRAсклад читает из этой таблицы для Live-мониторинга:

```sql
-- Пики за сегодня по сотруднику
SELECT COUNT(*) as picks_today,
       MAX(created_at) as last_pick_at
FROM sborka_live_events_s
WHERE employee_id = 42
  AND event_type = 'pick'
  AND created_at >= CURRENT_DATE;

-- Заказы за сегодня
SELECT COUNT(*) as orders_today
FROM sborka_live_events_s
WHERE employee_id = 42
  AND event_type = 'order_complete'
  AND created_at >= CURRENT_DATE;

-- Последние пики (для live-ленты)
SELECT * FROM sborka_live_events_s
WHERE created_at >= CURRENT_DATE
ORDER BY created_at DESC
LIMIT 50;
```

## Описание полей

| Поле | Тип | Обязательное | Описание |
|------|-----|-------------|----------|
| employee_id | INTEGER | ✅ | ID сотрудника из employees_s |
| event_type | VARCHAR | ✅ | `pick` — сканирование товара, `order_start` — начал заказ, `order_complete` — закончил заказ |
| order_id | VARCHAR | Желательно | Номер заказа (WB-123456) |
| product_name | TEXT | Для pick | Название товара |
| barcode | VARCHAR | Для pick | Штрих-код товара |
| quantity | INTEGER | Нет | По умолчанию 1 |
| marketplace | VARCHAR | Желательно | wb / ozon / yandex / sber |
| created_at | TIMESTAMPTZ | Автоматически | Время события |

## Итого

Сайту сборки нужно:
1. Выполнить CREATE TABLE (один раз)
2. При каждом сканировании делать INSERT с event_type='pick'
3. При начале/завершении заказа — INSERT с order_start/order_complete

Всё. Никаких API, токенов, HTTP запросов не нужно — прямая запись в общую БД.
