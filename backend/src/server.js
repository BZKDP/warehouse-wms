require('dotenv').config();
const http = require('http');
const app = require('./app');
const config = require('./config');
const { createSchema } = require('./db/schema');
const { runSeed } = require('./db/seed');
const { syncEmployeesFromOsite } = require('./utils/syncFromOsite');
const extListener = require('./utils/externalListener');
const { initSocket } = require('./socket');

// Prevent crashes from killing the process
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[CRASH] Unhandled rejection:', err?.message || err);
});

async function start() {
  try {
    await createSchema();
    await runSeed();
    const server = http.createServer(app);
    initSocket(server);
    server.listen(config.port, () => {
      console.log(`[Server] Running at http://localhost:${config.port}`);
      // Первый прогон сразу после старта
      syncEmployeesFromOsite().catch(err => console.error('[Sync] Initial sync failed:', err.message));
      // Триггеры на employees_d/users_d → pg_notify('employees_changed') →
      // мгновенный sync через LISTEN. Если прав нет — упадёт в логи и работаем
      // на lazy-sync (см. routes/staff.js) + страховочный интервал ниже.
      extListener.installExternalTriggers().then(() => extListener.start());
      // Страховочный фоновый sync раз в 5 минут на случай, если LISTEN-соединение
      // оборвалось и не успело переподключиться.
      setInterval(() => {
        syncEmployeesFromOsite().catch(err => console.error('[Sync] Periodic sync failed:', err.message));
      }, 5 * 60 * 1000);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err.message);
    process.exit(1);
  }
}

start();
