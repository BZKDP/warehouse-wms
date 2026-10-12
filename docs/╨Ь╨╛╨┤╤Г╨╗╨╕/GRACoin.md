# GRACoin — система вознаграждений

Фронтенд: `EarningsPage.jsx` (`/admin/earnings`).

API: `/api/earnings` — `backend/src/routes/earnings.js`.

## Концепция

GRACoin (GRA) — внутренняя валюта для мотивации сотрудников. Начисляется автоматически за выполнение складских операций.

## Формула начисления

```
Начисление = reward_units × rate_per_unit
```

- `rate_per_unit` — берётся из настройки `gra_inventory_scan_rate` (по умолчанию 10 GRA)
- `reward_units` — количество единиц в операции (обычно `quantity_delta` скана)

## Типы событий (event_type)

| Тип | Описание | Источник |
|---|---|---|
| `inventory_scan` | Сканирование при инвентаризации | Автоматически при скане |
| `manual_adjustment` | Ручная корректировка баланса | Админ через UI |
| `external_order_pick` | Сборка внешнего заказа | Внешняя система (сборка) |

## Таблица employee_earnings_s

### Основные поля
| Поле | Описание |
|---|---|
| employee_id | Сотрудник (FK employees_s) |
| event_type | Тип события |
| reward_units | Количество единиц |
| rate_per_unit | Ставка за единицу |
| amount_delta | Итоговое начисление |
| balance_before | Баланс до |
| balance_after | Баланс после |
| notes | Комментарий |
| created_by_user_id | Кто создал (для ручных) |

### Привязки к складским объектам
task_id, task_scan_id, task_box_id, shelf_id, box_id, shelf_box_id, product_id.

### Поля внешних начислений (external_order_pick)
| Поле | Описание |
|---|---|
| source | Источник (например, 'sborka') |
| source_marketplace | Маркетплейс (WB, Ozon...) |
| source_store_id / source_store_name | Магазин |
| source_entity_type / source_entity_id / source_entity_name | Тип и ID сущности |
| source_article | Артикул |
| source_product_name | Название товара |
| source_marketplace_code | Код маркетплейса |
| source_scanned_code | Отсканированный код |
| source_task_id | ID задачи из внешней системы |

## Баланс

- Хранится в `employees_s.gra_balance` (NUMERIC 18,3)
- Каждая транзакция содержит `balance_before` и `balance_after` для аудита
- Уникальный индекс на `task_scan_id` — предотвращает двойное начисление за один скан
- Админ может установить баланс: `POST /api/earnings/employees/:employeeId/set-balance`

## API эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| GET | /summary | Сводка: общий баланс, за сегодня/неделю |
| GET | /employees | Список заработков всех сотрудников |
| GET | /employees/:employeeId | Детали заработка сотрудника (с пагинацией) |
| GET | /tasks/:taskId | Заработок по задаче |
| POST | /employees/:employeeId/set-balance | Установить баланс |

## Связи

- [[Задачи]] — задачи генерируют начисления (inventory_scan)
- [[Сотрудники]] — баланс хранится в employees_s.gra_balance
- [[Настройки]] — ставка `gra_inventory_scan_rate`
