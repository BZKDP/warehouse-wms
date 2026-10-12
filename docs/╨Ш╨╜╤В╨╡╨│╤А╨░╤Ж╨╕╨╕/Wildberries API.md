# Wildberries API

## Назначение

Проверка штрихкодов товаров на маркетплейсе Wildberries. Два магазина, только чтение (read-only). Работает по аналогии с Ozon API.

## Магазины

| Ключ | Название | ENV-переменная |
|---|---|---|
| `wb_1` | WB ИП Ирина | `WB_TOKEN_1` |
| `wb_2` | WB ИП Евгений | `WB_TOKEN_2` |

## Эндпоинты

### GET /api/products/wb-stores
Список настроенных WB-магазинов с флагом `configured`.

### POST /api/products/check-wb
Проверка конкретных ШК на одном магазине (admin only).

```json
{ "barcodes": ["2000000000001", "4000000000001"], "store": "wb_1" }
```

Ответ:
```json
{
  "results": {
    "2000000000001": { "found": true, "wb_product": { "nmID": 12345678, "vendorCode": "ABC-123", "title": "Товар", "wbSize": "" } },
    "4000000000001": { "found": false }
  }
}
```

### POST /api/products/check-wb-all
Массовая проверка ВСЕХ товаров на одном WB-магазине (admin only). Автоматически обновляет `marketplace_barcodes_json`.

```json
{ "store": "wb_1" }
```

Ответ:
```json
{
  "store": "wb_1",
  "label": "WB ИП Ирина",
  "wb_products_count": 3200,
  "our_products_count": 287,
  "matched_count": 95,
  "not_found_count": 192,
  "matched": [...],
  "not_found": [...]
}
```

## Механизм работы

1. Загружает ВСЕ карточки из WB через пагинацию (100 шт/страница, до 100 страниц)
2. Строит карту: `barcode → { nmID, vendorCode, title, wbSize }`
3. Сравнивает со штрихкодами каждого товара в БД
4. Найденные — обновляет `marketplace_barcodes_json` с типом `wb_1` или `wb_2`

API Wildberries:
- Host: `content-api.wildberries.ru`
- Path: `/content/v2/get/cards/list`
- Method: POST
- Auth: header `Authorization: {token}`

## UI

### Карточка товара (ProductsPage)
- Две кнопки: **WB ИП И.** и **WB ИП Е.** (фиолетовые)
- Проверяет все ШК товара → ставит галочку найденным → обновляет тип в БД
- Раскрываемая инфо: артикул, nmID, название

### Настройки → Данные (SettingsPage)
- Блок «Проверка Wildberries магазинов»
- Кнопки для массовой проверки каждого магазина
- Статистика: на WB / наших / совпали / не найдены
- Список не найденных товаров

## Классификация штрихкодов

При импорте из [[МойСклад API]] штрихкоды WB определяются автоматически:
- Формат `20XXXXXXXXXX` или `20XXXXXXXXXXX` (12-13 цифр)
- Формат `40XXXXXXXXX` или `40XXXXXXXXXX` (11-12 цифр)

Сохраняются в `products_s.marketplace_barcodes_json` как `{type: 'wb', value: '...'}`, затем уточняются до `wb_1`/`wb_2` через массовую проверку.

## Связи

- [[Товары]] — проверка штрихкодов в карточке
- [[Деплой]] — переменные `WB_TOKEN_1`, `WB_TOKEN_2`
