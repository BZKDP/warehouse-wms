const crypto = require('crypto');
const pool = require('../db/pool');

const API_KEY_SCOPES = [
  {
    id: 'products:read', group: 'Товары', label: 'Чтение товаров',
    description: 'Список товаров и карточка одной позиции без изменения данных.',
  },
  {
    id: 'products:create', group: 'Товары', label: 'Создание товаров',
    description: 'Создание новых позиций каталога.',
  },
  {
    id: 'products:update', group: 'Товары', label: 'Изменение товаров',
    description: 'Изменение названия, артикула, типа, цен, заметок и других полей карточки.',
  },
  {
    id: 'products:archive', group: 'Товары', label: 'Архивирование товаров',
    description: 'Деактивация и восстановление карточек. Физические данные не удаляются.',
    dangerous: true,
  },
  {
    id: 'barcodes:write', group: 'Штрихкоды', label: 'Изменение штрихкодов',
    description: 'Назначение производственного, дополнительных и маркетплейсных штрихкодов.',
    dangerous: true,
  },
  {
    id: 'stock:read', group: 'Остатки', label: 'Чтение остатков',
    description: 'Сводные остатки, складские места и товар на руках у сотрудников.',
  },
  {
    id: 'stock:write', group: 'Остатки', label: 'Изменение сводных остатков',
    description: 'Изменение полей stock, reserve, in_transit и quantity в карточке товара.',
    dangerous: true,
  },
  {
    id: 'movements:read', group: 'История', label: 'Чтение перемещений',
    description: 'Просмотр журнала перемещений выбранного товара.',
  },
];

const VALID_SCOPES = new Set(API_KEY_SCOPES.map((scope) => scope.id));
const rateWindows = new Map();

function hashApiKey(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function generateApiKey() {
  const publicPart = crypto.randomBytes(6).toString('hex');
  const secretPart = crypto.randomBytes(32).toString('base64url');
  const prefix = `gra_sklad_${publicPart}`;
  const token = `${prefix}_${secretPart}`;
  return { token, prefix, hash: hashApiKey(token) };
}

function keyPrefixFromToken(token) {
  const match = String(token || '').match(/^(gra_sklad_[a-f0-9]{12})_/i);
  return match ? match[1] : null;
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  return [...new Set(scopes.map((scope) => String(scope || '').trim()).filter(Boolean))];
}

function validateScopes(scopes) {
  const normalized = normalizeScopes(scopes);
  const invalid = normalized.filter((scope) => !VALID_SCOPES.has(scope));
  return { scopes: normalized, invalid };
}

function hasScope(apiKey, scope) {
  return Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(scope);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function applyRateLimit(req, res, apiKey) {
  const limit = Math.max(1, Number(apiKey.rate_limit_per_minute) || 120);
  const now = Date.now();
  const bucket = rateWindows.get(apiKey.id);
  const current = !bucket || bucket.resetAt <= now
    ? { count: 0, resetAt: now + 60_000 }
    : bucket;
  current.count += 1;
  rateWindows.set(apiKey.id, current);

  const remaining = Math.max(0, limit - current.count);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

  if (current.count > limit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: 'Превышен лимит запросов для этого API-ключа',
      request_id: req.id,
    });
    return false;
  }
  return true;
}

async function requireApiKey(req, res, next) {
  const token = bearerToken(req);
  req.apiKeyPrefix = keyPrefixFromToken(token);
  if (!token) {
    return res.status(401).json({
      error: 'missing_api_key',
      message: 'Передайте API-ключ в заголовке Authorization: Bearer <ключ>',
      request_id: req.id,
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, key_prefix, scopes, active, expires_at,
              rate_limit_per_minute, revoked_at
         FROM api_keys_s
        WHERE key_hash = $1
        LIMIT 1`,
      [hashApiKey(token)]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: 'invalid_api_key', message: 'API-ключ не найден', request_id: req.id,
      });
    }

    const apiKey = result.rows[0];
    apiKey.scopes = normalizeScopes(apiKey.scopes);
    req.apiKey = apiKey;
    req.apiKeyPrefix = apiKey.key_prefix;

    if (!apiKey.active || apiKey.revoked_at) {
      return res.status(401).json({
        error: 'api_key_revoked', message: 'API-ключ отозван', request_id: req.id,
      });
    }
    if (apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= Date.now()) {
      return res.status(401).json({
        error: 'api_key_expired', message: 'Срок действия API-ключа истёк', request_id: req.id,
      });
    }
    if (!applyRateLimit(req, res, apiKey)) return undefined;

    pool.query(
      `UPDATE api_keys_s
          SET last_used_at = NOW(), last_used_ip = $2, updated_at = NOW()
        WHERE id = $1`,
      [apiKey.id, req.ip || null]
    ).catch(() => {});
    return next();
  } catch (err) {
    return res.status(503).json({
      error: 'api_auth_unavailable',
      message: 'Сервис проверки API-ключей временно недоступен',
      request_id: req.id,
    });
  }
}

function requireApiScope(...requiredScopes) {
  return (req, res, next) => {
    const missing = requiredScopes.filter((scope) => !hasScope(req.apiKey, scope));
    if (!missing.length) return next();
    return res.status(403).json({
      error: 'insufficient_scope',
      message: 'У API-ключа недостаточно прав для этой операции',
      required_scopes: requiredScopes,
      missing_scopes: missing,
      request_id: req.id,
    });
  };
}

function sanitizedBody(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizedBody(item, depth + 1));
  if (typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2000) : value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api.?key|authorization/i.test(key)) result[key] = '[REDACTED]';
    else result[key] = sanitizedBody(item, depth + 1);
  }
  return result;
}

function sanitizedRequestPath(req) {
  const raw = String(req.originalUrl || req.path || '').slice(0, 8000);
  try {
    const url = new URL(raw, 'http://api.local');
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|api.?key|authorization/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return raw.replace(/([?&](?:access_?token|token|secret|password|api_?key|authorization)=)[^&]*/gi, '$1[REDACTED]');
  }
}

function apiRequestAudit(req, res, next) {
  const startedAt = process.hrtime.bigint();
  let responseError = null;
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (res.statusCode >= 400 && payload && typeof payload === 'object') {
      responseError = {
        code: payload.error || null,
        message: payload.message || payload.error || null,
      };
    }
    return originalJson(payload);
  };

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const body = req.body && Object.keys(req.body).length ? sanitizedBody(req.body) : null;
    const internalError = res.locals.apiInternalError;
    const loggedError = internalError
      ? { code: 'internal_error', message: internalError.message || String(internalError) }
      : responseError;
    pool.query(
      `INSERT INTO api_request_logs_s
         (api_key_id, key_prefix, request_id, operation, method, path,
          status_code, duration_ms, ip_address, user_agent, request_body,
          error_code, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        req.apiKey?.id || null,
        req.apiKey?.key_prefix || req.apiKeyPrefix || keyPrefixFromToken(bearerToken(req)),
        req.id || null,
        req.apiOperation || `${req.method} ${req.route?.path || req.path}`,
        req.method,
        sanitizedRequestPath(req),
        res.statusCode,
        Math.round(durationMs * 100) / 100,
        req.ip || null,
        String(req.headers['user-agent'] || '').slice(0, 1000) || null,
        body ? JSON.stringify(body) : null,
        loggedError?.code || null,
        loggedError?.message ? String(loggedError.message).slice(0, 2000) : null,
      ]
    ).catch(() => {});
  });
  next();
}

function apiOperation(name) {
  return (req, _res, next) => {
    req.apiOperation = name;
    next();
  };
}

module.exports = {
  API_KEY_SCOPES,
  VALID_SCOPES,
  apiOperation,
  apiRequestAudit,
  generateApiKey,
  hasScope,
  hashApiKey,
  normalizeScopes,
  requireApiKey,
  requireApiScope,
  validateScopes,
};
