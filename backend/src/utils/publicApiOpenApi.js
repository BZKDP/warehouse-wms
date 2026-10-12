const { API_KEY_SCOPES } = require('./apiKeys');

const errorSchema = {
  type: 'object',
  required: ['error', 'message', 'request_id'],
  properties: {
    error: { type: 'string', description: 'Стабильный машинный код ошибки', example: 'validation_error' },
    message: { type: 'string', description: 'Понятное человеку описание на русском языке' },
    request_id: { type: 'string', description: 'Идентификатор запроса для поиска в журнале', example: 'a0f17c2d' },
    required_scopes: { type: 'array', items: { type: 'string' } },
  },
};

const metaProperties = {
  request_id: { type: 'string', example: 'a0f17c2d' },
  api_version: { type: 'string', example: '1.0.0' },
};

const productSchema = {
  type: 'object',
  required: ['id', 'name', 'entity_type', 'barcodes', 'archived', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'integer', example: 192, readOnly: true },
    external_id: { type: ['string', 'null'], description: 'ID позиции во внешнем каталоге, если она импортирована' },
    name: { type: 'string', maxLength: 500, example: 'Астаксантин + Q10 + PQQ + МСТ 60 капсул' },
    code: { type: ['string', 'null'], maxLength: 255 },
    article: { type: ['string', 'null'], maxLength: 255, example: 'GRA-11900' },
    entity_type: { type: 'string', enum: ['product', 'bundle'], description: 'Обычный товар или комплект' },
    barcodes: {
      type: 'object',
      properties: {
        production: { type: ['string', 'null'], description: 'Системный/производственный штрихкод' },
        additional: { type: 'array', items: { type: 'string' }, description: 'Дополнительные штрихкоды' },
        marketplace: {
          type: 'array',
          items: { $ref: '#/components/schemas/MarketplaceBarcode' },
          description: 'Штрихкоды с указанием магазина/маркетплейса',
        },
      },
    },
    folder_path: { type: ['string', 'null'], description: 'Путь папки каталога' },
    archived: { type: 'boolean', description: 'Карточка скрыта из рабочего каталога' },
    sale_price: { type: ['number', 'null'], format: 'decimal', minimum: 0 },
    cost_price: { type: ['number', 'null'], format: 'decimal', minimum: 0 },
    honest_sign: { type: 'boolean', description: 'Для товара требуется маркировка «Честный знак»' },
    notes: { type: ['string', 'null'] },
    alt_names: { type: ['string', 'null'], description: 'Синонимы для поиска' },
    stock: {
      allOf: [{ $ref: '#/components/schemas/StockSnapshot' }],
      description: 'Возвращается только при наличии scope stock:read',
    },
    created_at: { type: 'string', format: 'date-time', readOnly: true },
    updated_at: { type: 'string', format: 'date-time', readOnly: true },
  },
};

function standardErrors() {
  return {
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    403: { $ref: '#/components/responses/Forbidden' },
    409: { $ref: '#/components/responses/Conflict' },
    429: { $ref: '#/components/responses/RateLimit' },
    500: { $ref: '#/components/responses/InternalError' },
  };
}

function bearerSecurity() {
  // Для HTTP Bearer OpenAPI требует пустой массив (scopes применимы только к
  // OAuth2/OpenID). Нужные права подробно перечислены в описании операций.
  return [{ BearerAuth: [] }];
}

function buildOpenApi(appBasePath = '') {
  const base = `${appBasePath || ''}/api/public/v1`;
  return {
    openapi: '3.1.0',
    info: {
      title: 'GRAсклад Public API',
      version: '1.0.0',
      summary: 'Управление товарным каталогом GRAсклада из внешних систем',
      description: `
# Назначение

API предназначен для контролируемого обмена данными между **GRAскладом** и внешними сервисами: базой знаний, маркетплейсами, производственными инструментами и внутренними автоматизациями.

Через API можно читать каталог и физические остатки, создавать и изменять товары, управлять штрихкодами, архивировать карточки и читать историю перемещений. Каждое действие записывается в журнал портала.

## Авторизация

Передавайте ключ только в HTTP-заголовке:

\`Authorization: Bearer gra_sklad_…\`

Ключ показывается оператору один раз при создании. GRAсклад хранит только SHA-256 хэш, поэтому восстановить утерянный секрет невозможно — ключ нужно перевыпустить.

## Права доступа

${API_KEY_SCOPES.map((scope) => `- **${scope.id}** — ${scope.description}`).join('\n')}

Для метода могут требоваться сразу несколько прав. Например, чтение складских мест требует \`products:read\` и \`stock:read\`.

## Безопасное изменение данных

- \`PATCH\` изменяет только переданные поля; отсутствующие поля сохраняются.
- \`DELETE\` не удаляет строку физически, а переводит товар в архив.
- Архивирование товара с остатком возвращает \`409 product_has_stock\`. Принудительный режим \`force=true\` дополнительно требует \`stock:write\`.
- Штрихкод, уже принадлежащий другому товару, возвращает \`409 barcode_conflict\`.
- Поля сводного остатка могут быть перезаписаны следующей синхронизацией с МойСклад. Физические размещения через этот API не меняются.

## Трассировка и журнал

Каждый ответ содержит \`request_id\`; тот же идентификатор возвращается в заголовке \`X-Request-Id\` и виден в настройках портала. В журнале сохраняются ключ, операция, HTTP-статус, длительность, IP и очищенное от секретов тело запроса.

## Ограничение запросов

Лимит задаётся отдельно для каждого ключа. Заголовки \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\` и \`X-RateLimit-Reset\` показывают текущее состояние. При превышении возвращается HTTP 429 и \`Retry-After\`.
      `.trim(),
      contact: { name: 'Администратор GRAсклада' },
    },
    servers: [{ url: base, description: 'Текущий портал GRAсклада' }],
    tags: [
      { name: 'Сервис', description: 'Проверка доступности и текущего ключа' },
      { name: 'Товары', description: 'Каталог, карточки и безопасные операции записи' },
      { name: 'Остатки', description: 'Сводный остаток и физическое размещение по складам' },
      { name: 'Перемещения', description: 'Постраничная история операций с товаром' },
    ],
    paths: {
      '/status': {
        get: {
          tags: ['Сервис'], operationId: 'getApiStatus', summary: 'Проверить доступность API',
          description: 'Публичный health-check. API-ключ не требуется; товарные данные не возвращаются.',
          security: [],
          responses: {
            200: {
              description: 'API работает',
              content: { 'application/json': { example: { ok: true, service: 'GRAсклад Public API', version: '1.0.0', timestamp: '2026-08-26T16:00:00.000Z', request_id: 'a0f17c2d' } } },
            },
          },
        },
      },
      '/me': {
        get: {
          tags: ['Сервис'], operationId: 'inspectApiKey', summary: 'Проверить ключ и его права',
          description: 'Удобный первый запрос после выдачи ключа. Возвращает имя, префикс, scopes, лимит и дату окончания. Секрет не возвращается.',
          security: bearerSecurity(),
          responses: {
            200: { description: 'Ключ действителен', content: { 'application/json': { schema: { type: 'object' }, example: { key: { id: 7, name: 'База знаний', prefix: 'gra_sklad_a19f88c201db', scopes: ['products:read', 'stock:read'], rate_limit_per_minute: 120, expires_at: null }, request_id: 'a0f17c2d', api_version: '1.0.0' } } } },
            ...standardErrors(),
          },
        },
      },
      '/products': {
        get: {
          tags: ['Товары'], operationId: 'listProducts', summary: 'Получить список товаров',
          description: 'Постраничный поиск по названию, артикулу, коду, штрихкоду и синонимам. Блок stock присутствует только при scope stock:read.',
          security: bearerSecurity(['products:read']),
          parameters: [
            { name: 'q', in: 'query', description: 'Полнотекстовый поиск по основным идентификаторам', schema: { type: 'string' }, example: 'астаксантин' },
            { name: 'sku', in: 'query', description: 'Точный GRA-артикул без учёта регистра', schema: { type: 'string' }, example: 'GRA-11900' },
            { name: 'entity_type', in: 'query', schema: { type: 'string', enum: ['product', 'bundle'] } },
            { name: 'archived', in: 'query', description: 'По умолчанию false', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'false' } },
            { name: 'in_stock', in: 'query', description: 'Требует stock:read', schema: { type: 'boolean' } },
            { name: 'updated_since', in: 'query', description: 'Только изменённые после указанного времени', schema: { type: 'string', format: 'date-time' } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['name', 'article', 'updated_at', 'stock'], default: 'name' } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
          ],
          responses: {
            200: { description: 'Страница каталога', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductListResponse' } } } },
            ...standardErrors(),
          },
        },
        post: {
          tags: ['Товары'], operationId: 'createProduct', summary: 'Создать товар',
          description: 'Создаёт новую позицию. Артикул должен быть уникальным. Штрихкоды требуют barcodes:write, поля остатка — stock:write.',
          security: bearerSecurity(['products:create']),
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductCreate' }, examples: {
              minimal: { summary: 'Минимальная карточка', value: { article: 'GRA-12345', name: 'Новый товар, 60 капсул' } },
              full: { summary: 'Карточка со штрихкодами', value: { article: 'GRA-12345', name: 'Новый товар, 60 капсул', entity_type: 'product', production_barcode: '400000009999', barcodes: ['OZN1234567890'], marketplace_barcodes: [{ type: 'ozon_1', value: 'OZN1234567890' }], honest_sign: false, notes: 'Создано интеграцией' } },
            } } },
          },
          responses: {
            201: { description: 'Товар создан', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductResponse' } } } },
            ...standardErrors(),
          },
        },
      },
      '/products/{article}': {
        parameters: [{ $ref: '#/components/parameters/Article' }],
        get: {
          tags: ['Товары'], operationId: 'getProduct', summary: 'Получить одну карточку',
          description: 'Ищет точное значение article, а при его отсутствии — code. Если в базе есть дубликаты артикула, возвращает 409 вместо случайного выбора.',
          security: bearerSecurity(['products:read']),
          responses: {
            200: { description: 'Карточка товара', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductResponse' } } } },
            404: { $ref: '#/components/responses/NotFound' }, ...standardErrors(),
          },
        },
        patch: {
          tags: ['Товары'], operationId: 'updateProduct', summary: 'Изменить отдельные поля товара',
          description: `Используйте PATCH, а не полную замену: отсутствующие поля остаются без изменений.

Дополнительные scopes по полям:
- штрихкоды — barcodes:write;
- stock/reserve/in_transit/quantity — stock:write;
- archived — products:archive.

При archived=true товар с остатком блокируется. Для осознанного обхода добавьте force=true; ключу также потребуется stock:write.`,
          security: bearerSecurity(['products:update']),
          parameters: [{ name: 'force', in: 'query', description: 'Разрешить архивирование карточки с остатком', schema: { type: 'boolean', default: false } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductPatch' }, examples: {
              rename: { summary: 'Изменить только название', value: { name: 'Уточнённое название, 60 капсул' } },
              barcode: { summary: 'Назначить производственный штрихкод', value: { production_barcode: '400000009999' } },
              restore: { summary: 'Вернуть карточку из архива', value: { archived: false } },
            } } },
          },
          responses: {
            200: { description: 'Изменённая карточка и список changed_fields', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductResponse' } } } },
            404: { $ref: '#/components/responses/NotFound' }, ...standardErrors(),
          },
        },
        delete: {
          tags: ['Товары'], operationId: 'archiveProduct', summary: 'Архивировать товар',
          description: 'Soft delete: строка, связи и история сохраняются. Повторный вызов идемпотентен. Товар с остатком требует force=true и дополнительный scope stock:write.',
          security: bearerSecurity(['products:archive']),
          parameters: [{ name: 'force', in: 'query', description: 'Архивировать несмотря на остаток', schema: { type: 'boolean', default: false } }],
          responses: {
            200: { description: 'Карточка в архиве', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductResponse' } } } },
            404: { $ref: '#/components/responses/NotFound' }, ...standardErrors(),
          },
        },
      },
      '/products/{article}/stock': {
        parameters: [{ $ref: '#/components/parameters/Article' }],
        get: {
          tags: ['Остатки'], operationId: 'getProductStock', summary: 'Получить остаток и размещение',
          description: 'Возвращает отдельно сводные поля каталога и фактические ненулевые размещения: полки, паллеты, коробки и товар на руках у сотрудников.',
          security: bearerSecurity(['products:read', 'stock:read']),
          responses: {
            200: { description: 'Остаток по источникам', content: { 'application/json': { schema: { $ref: '#/components/schemas/StockResponse' } } } },
            404: { $ref: '#/components/responses/NotFound' }, ...standardErrors(),
          },
        },
      },
      '/products/{article}/movements': {
        parameters: [
          { $ref: '#/components/parameters/Article' },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ],
        get: {
          tags: ['Перемещения'], operationId: 'getProductMovements', summary: 'Получить историю перемещений',
          description: 'Последние операции первыми. Для каждой строки возвращаются количество, источник, места отправления/назначения, исполнитель, заметка и время.',
          security: bearerSecurity(['products:read', 'movements:read']),
          responses: {
            200: { description: 'Страница журнала перемещений', content: { 'application/json': { schema: { $ref: '#/components/schemas/MovementListResponse' } } } },
            404: { $ref: '#/components/responses/NotFound' }, ...standardErrors(),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http', scheme: 'bearer', bearerFormat: 'GRA API key',
          description: 'Ключ вида gra_sklad_…. Не передавайте его в query string.',
        },
      },
      parameters: {
        Article: { name: 'article', in: 'path', required: true, description: 'Точный GRA-артикул', schema: { type: 'string' }, example: 'GRA-11900' },
      },
      schemas: {
        Error: errorSchema,
        MarketplaceBarcode: {
          type: 'object', required: ['type', 'value'],
          properties: {
            type: { type: 'string', description: 'Источник, например ozon_1, ozon_2, wb_1 или wb_2', example: 'ozon_1' },
            value: { type: 'string', example: 'OZN4382499586' },
          },
        },
        StockSnapshot: {
          type: 'object',
          properties: {
            stock: { type: 'number', description: 'Доступно по сводному каталогу' },
            reserve: { type: 'number' }, in_transit: { type: 'number' }, quantity: { type: 'number' },
          },
        },
        Product: productSchema,
        ProductCreate: {
          type: 'object', required: ['name', 'article'],
          properties: {
            name: productSchema.properties.name, article: productSchema.properties.article,
            code: productSchema.properties.code, entity_type: productSchema.properties.entity_type,
            production_barcode: { type: ['string', 'null'] },
            barcodes: { type: 'array', items: { type: 'string' } },
            marketplace_barcodes: { type: 'array', items: { $ref: '#/components/schemas/MarketplaceBarcode' } },
            stock: { type: 'number', minimum: 0, default: 0 }, reserve: { type: 'number', minimum: 0, default: 0 },
            in_transit: { type: 'number', minimum: 0, default: 0 }, quantity: { type: 'number', minimum: 0, default: 0 },
            folder_path: productSchema.properties.folder_path, archived: productSchema.properties.archived,
            sale_price: productSchema.properties.sale_price, cost_price: productSchema.properties.cost_price,
            honest_sign: productSchema.properties.honest_sign, notes: productSchema.properties.notes,
            alt_names: productSchema.properties.alt_names,
          },
        },
        ProductPatch: {
          type: 'object',
          description: 'Все поля необязательны. Передавайте только изменяемые поля.',
          properties: {
            name: productSchema.properties.name, article: productSchema.properties.article,
            code: productSchema.properties.code, entity_type: productSchema.properties.entity_type,
            production_barcode: { type: ['string', 'null'] },
            barcodes: { type: 'array', items: { type: 'string' } },
            marketplace_barcodes: { type: 'array', items: { $ref: '#/components/schemas/MarketplaceBarcode' } },
            stock: { type: ['number', 'null'], minimum: 0 }, reserve: { type: ['number', 'null'], minimum: 0 },
            in_transit: { type: ['number', 'null'], minimum: 0 }, quantity: { type: ['number', 'null'], minimum: 0 },
            folder_path: productSchema.properties.folder_path, archived: productSchema.properties.archived,
            sale_price: productSchema.properties.sale_price, cost_price: productSchema.properties.cost_price,
            honest_sign: productSchema.properties.honest_sign, notes: productSchema.properties.notes,
            alt_names: productSchema.properties.alt_names,
          },
        },
        ProductResponse: {
          type: 'object', required: ['data', 'request_id', 'api_version'],
          properties: { data: { $ref: '#/components/schemas/Product' }, changed_fields: { type: 'array', items: { type: 'string' } }, ...metaProperties },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' },
            pages: { type: 'integer' }, has_more: { type: 'boolean' },
          },
        },
        ProductListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
            pagination: { $ref: '#/components/schemas/Pagination' }, ...metaProperties,
          },
        },
        StockLocation: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['shelf', 'pallet', 'pallet_box', 'shelf_box', 'employee'] },
            warehouse: { type: ['string', 'null'] }, location: { type: 'string' },
            quantity: { type: 'number' }, updated_at: { type: 'string', format: 'date-time' },
          },
        },
        StockResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                article: { type: 'string' }, product_name: { type: 'string' },
                catalog: { $ref: '#/components/schemas/StockSnapshot' }, physical_total: { type: 'number' },
                locations: { type: 'array', items: { $ref: '#/components/schemas/StockLocation' } },
              },
            },
            ...metaProperties,
          },
        },
        MovementListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pagination: { $ref: '#/components/schemas/Pagination' }, ...metaProperties,
          },
        },
      },
      responses: {
        BadRequest: { description: 'Некорректные параметры или тело запроса', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Unauthorized: { description: 'Ключ отсутствует, неизвестен, отозван или просрочен', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Forbidden: { description: 'У ключа не хватает одного или нескольких scopes', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        NotFound: { description: 'Товар не найден', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Conflict: { description: 'Конфликт артикула, штрихкода, дубликат карточки или ненулевой остаток', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        RateLimit: { description: 'Лимит запросов исчерпан; используйте Retry-After', headers: { 'Retry-After': { schema: { type: 'integer' } } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        InternalError: { description: 'Внутренняя ошибка. Передайте request_id администратору.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}

function renderApiDocs(appBasePath = '') {
  const specUrl = `${appBasePath || ''}/api/public/v1/openapi.json`;
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>GRAсклад API — документация</title>
  <style>
    :root{color-scheme:light;--ink:#172033;--muted:#667085;--purple:#6d4aff;--line:#e7e9f0}
    *{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .api-topbar{position:sticky;top:0;z-index:20;height:58px;display:flex;align-items:center;gap:14px;padding:0 24px;background:rgba(255,255,255,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(14px)}
    .api-mark{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:linear-gradient(145deg,#886cff,#5e3ee8);color:#fff;font-weight:900;box-shadow:0 7px 20px rgba(109,74,255,.23)}
    .api-title{font-weight:750;letter-spacing:-.02em}.api-version{font-size:12px;color:var(--muted);padding:4px 8px;border:1px solid var(--line);border-radius:999px}
    .api-json{margin-left:auto;color:var(--purple);font-size:13px;text-decoration:none;font-weight:650}.api-json:hover{text-decoration:underline}
    #redoc-container{min-height:calc(100vh - 58px)}
    .loading{display:grid;place-items:center;min-height:60vh;color:var(--muted)}
    @media(max-width:700px){.api-topbar{padding:0 14px}.api-title{font-size:14px}.api-json{font-size:0}.api-json:after{content:'JSON';font-size:12px}}
  </style>
</head>
<body>
  <header class="api-topbar">
    <div class="api-mark">G</div><div class="api-title">GRAсклад · Public API</div>
    <div class="api-version">v1</div><a class="api-json" href="${specUrl}">Открыть OpenAPI JSON</a>
  </header>
  <div id="redoc-container"><div class="loading">Загрузка документации…</div></div>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  <script>
    Redoc.init('${specUrl}', {
      hideDownloadButton:false, disableSearch:false, expandResponses:'200,201',
      requiredPropsFirst:true, sortRequiredPropsFirst:true, pathInMiddlePanel:true,
      theme:{colors:{primary:{main:'#6d4aff'},success:{main:'#198754'},error:{main:'#d92d20'},text:{primary:'#172033',secondary:'#667085'},border:{dark:'#d0d5dd',light:'#e7e9f0'}},typography:{fontFamily:'Inter, ui-sans-serif, system-ui, sans-serif',headings:{fontFamily:'Inter, ui-sans-serif, system-ui, sans-serif',fontWeight:'750'},code:{fontFamily:'JetBrains Mono, SFMono-Regular, Consolas, monospace'}},sidebar:{backgroundColor:'#f7f8fb',textColor:'#344054',activeTextColor:'#6d4aff'},rightPanel:{backgroundColor:'#151923'},spacing:{unit:5}}
    }, document.getElementById('redoc-container'));
  </script>
</body>
</html>`;
}

module.exports = { buildOpenApi, renderApiDocs };
