const { Client } = require('pg');
const config = require('../config');
const { syncEmployeesFromOsite } = require('./syncFromOsite');

/**
 * Постоянное LISTEN-соединение с внешней БД (сайт сотрудников).
 * Подписывается на канал 'employees_changed' и при любом NOTIFY
 * мгновенно прогоняет syncEmployeesFromOsite.
 *
 * Каналы и триггеры на employees_d / users_d ставятся отдельно
 * (см. installExternalTriggers ниже) — без них NOTIFY не придёт.
 *
 * Подключение использует обычный pg.Client (а не Pool), потому что
 * LISTEN требует постоянного соединения. При обрыве — авто-реконнект
 * с экспоненциальной задержкой.
 */

const CHANNEL = 'employees_changed';
let client = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 60 * 1000;

// Дебаунс: если прилетает 10 NOTIFY за миллисекунду (массовое обновление),
// прогоняем sync один раз через 200ms.
let pendingTimer = null;
function scheduleSync() {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    syncEmployeesFromOsite().catch(err => console.error('[ExtListener] Sync failed:', err.message));
  }, 200);
}

async function connect() {
  client = new Client({
    host: config.externalDb.host,
    port: config.externalDb.port,
    database: config.externalDb.database,
    user: config.externalDb.user,
    password: config.externalDb.password,
    ssl: config.externalDb.ssl ? { rejectUnauthorized: false } : false,
  });

  client.on('notification', (msg) => {
    if (msg.channel === CHANNEL) {
      console.log(`[ExtListener] NOTIFY ${CHANNEL} payload=${msg.payload || ''}`);
      scheduleSync();
    }
  });

  client.on('error', (err) => {
    console.error('[ExtListener] Client error:', err.message);
  });

  client.on('end', () => {
    console.warn('[ExtListener] Connection ended, reconnecting in', reconnectDelay, 'ms');
    setTimeout(start, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    console.log(`[ExtListener] Subscribed to ${CHANNEL}`);
    reconnectDelay = 1000; // reset на успешном коннекте
  } catch (err) {
    console.error('[ExtListener] Connect failed:', err.message);
    setTimeout(start, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }
}

function start() {
  connect().catch(err => console.error('[ExtListener] Start failed:', err.message));
}

/**
 * Установка триггеров на employees_d / users_d, которые делают
 * pg_notify('employees_changed', <table>) при INSERT/UPDATE/DELETE.
 *
 * Запускается один раз при старте сервера. Если прав нет — логируется
 * ошибка, и продолжаем работать на lazy-sync + периодическом интервале.
 *
 * Сами таблицы НЕ меняются. Только добавляется триггер.
 */
async function installExternalTriggers() {
  const externalPool = require('../db/externalPool');
  const sql = `
    CREATE OR REPLACE FUNCTION sklad_notify_employees_changed() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('employees_changed', TG_TABLE_NAME || ':' || COALESCE(NEW.id::text, OLD.id::text, ''));
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sklad_notify_employees ON employees_d;
    CREATE TRIGGER trg_sklad_notify_employees
      AFTER INSERT OR UPDATE OR DELETE ON employees_d
      FOR EACH ROW EXECUTE FUNCTION sklad_notify_employees_changed();

    DROP TRIGGER IF EXISTS trg_sklad_notify_users ON users_d;
    CREATE TRIGGER trg_sklad_notify_users
      AFTER INSERT OR UPDATE OR DELETE ON users_d
      FOR EACH ROW EXECUTE FUNCTION sklad_notify_employees_changed();
  `;
  try {
    await externalPool.query(sql);
    console.log('[ExtListener] Triggers installed on employees_d/users_d');
  } catch (err) {
    console.error('[ExtListener] Failed to install triggers (нет прав?):', err.message);
    console.error('[ExtListener] Falling back to lazy-sync + interval polling.');
  }
}

module.exports = { start, installExternalTriggers };
