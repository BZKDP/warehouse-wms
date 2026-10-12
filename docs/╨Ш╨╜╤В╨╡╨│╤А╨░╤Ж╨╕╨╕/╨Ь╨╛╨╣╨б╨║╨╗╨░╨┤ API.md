# МойСклад (MoySklad) API

## Назначение

Внешняя ERP-система. Источник данных для первоначального заполнения каталога.

API base: `https://api.moysklad.ru/api/remap/1.2`

## Конфигурация

| Параметр | ENV | Описание |
|---|---|---|
| Токен API | `MOYSKLAD_TOKEN` | Bearer-токен для доступа к API |
| Директория экспорта | `CATALOG_SOURCE_DIR` | Путь к JSON-файлам экспорта (default: `C:\ARRA\Work\moiskladimport`) |

Настройка в `backend/src/config.js`:
```js
moySkladToken: process.env.MOYSKLAD_TOKEN || '',
catalogSourceDir: process.env.CATALOG_SOURCE_DIR || 'C:\\ARRA\\Work\\moiskladimport',
moySkladApiBase: 'https://api.moysklad.ru/api/remap/1.2',
```

## Механизм импорта

Файл: `backend/src/utils/catalogImport.js`

Импорт работает через экспортированные JSON-файлы, а не напрямую через API:
1. Скрипт `backend/src/scripts/exportMoySkladStockByCells.js` выгружает данные из МС в папку `moysklad_export_{timestamp}`
2. `POST /api/products/sync` ищет последнюю папку `moysklad_export_*` в `CATALOG_SOURCE_DIR`
3. Читает JSON-файлы и импортирует в БД через UPSERT (ON CONFLICT external_id)

### Структура экспорта

| Файл | Содержимое | Целевая таблица |
|---|---|---|
| `details_nash_brend_proizvodstvo.json` | Товары (production) | `products_s` (entity_type='product') |
| `details_nash_brend_komplekty.json` | Комплекты (bundles) | `products_s` (entity_type='bundle') |
| `stock_izhevsk_fbs.json` | Остатки (stock, reserve, inTransit) | `products_s` (stock поля) |
| `productfolders_all.json` | Папки товаров | `product_folders_s` |

## Импортируемые данные

| Из МойСклад | В систему | Примечание |
|---|---|---|
| Товары | `products_s` | name, code, article, barcodes, stock |
| Комплекты | `products_s` + `bundle_components_s` | entity_type='bundle' |
| Папки | `product_folders_s` | Иерархия через parent_id |
| Материалы | `raw_materials_s` | name, unit, stock, buy_price |
| Техкарты (processingplan) | `tech_cards_s` + `tech_card_materials_s` | Связь product_id → materials |

Все исходные данные из МойСклад сохраняются в поле `source_json` (JSONB) для аудита и fallback.

## Штрихкоды

При импорте штрихкоды классифицируются автоматически:
- Начинается с `46` + 11 цифр → `production_barcode`
- Формат `OZN*` или `Z*` → marketplace barcode (ozon)
- Начинается с `20` или `40` → marketplace barcode (wb)
- Все штрихкоды → `barcode_list` (через `;`)

## История импорта

Каждый импорт записывается в `import_runs_s`:
- `status`: running → success / error
- `products_count`, `bundles_count`
- `errors_json` — массив ошибок

Эндпоинт: `GET /api/products/import/history` (последние 10 записей).

## Связи

- [[Товары]] — каталог товаров
- [[Сырьё]] — материалы и техкарты
- [[Деплой]] — переменная `MOYSKLAD_TOKEN`
