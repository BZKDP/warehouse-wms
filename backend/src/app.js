const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');

const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const warehouseRoutes = require('./routes/warehouse');
const tasksRoutes = require('./routes/tasks');
const fboRoutes = require('./routes/fbo');
const packingRoutes = require('./routes/packing');
const staffRoutes = require('./routes/staff');
const settingsRoutes = require('./routes/settings');
const syserrorsRoutes = require('./routes/syserrors');
const movementsRoutes = require('./routes/movements');
const earningsRoutes = require('./routes/earnings');
const materialsRoutes = require('./routes/materials');
const feedbackRoutes = require('./routes/feedback');
const apiManagementRoutes = require('./routes/apiManagement');
const publicApiRoutes = require('./routes/publicApi');
const barcodeDisputesRoutes = require('./routes/barcodeDisputes');
const crypto = require('crypto');
const { requireAuth } = require('./middleware/auth');

const app = express();
const siteRouter = express.Router();

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '15mb' }));

// Request ID for tracing
app.use((req, res, _next) => {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  _next();
});

// Rate limiting for sensitive endpoints
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Слишком много попыток, попробуйте через минуту' },
  standardHeaders: true,
  legacyHeaders: false,
});
const errorReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

// API routes

siteRouter.use('/api/auth/login', loginLimiter);
siteRouter.use('/api/errors/system', errorReportLimiter);
// No-cache for API responses
siteRouter.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Health check
siteRouter.get('/api/health', async (_req, res) => {
  try {
    const pool = require('./db/pool');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});
siteRouter.use('/api/auth', authRoutes);
siteRouter.use('/api/products', productsRoutes);
siteRouter.use('/api/warehouse', warehouseRoutes);
siteRouter.use('/api/tasks', tasksRoutes);
siteRouter.use('/api/fbo', fboRoutes);
siteRouter.use('/api/packing', packingRoutes);
siteRouter.use('/api/staff', staffRoutes);
siteRouter.use('/api/settings', settingsRoutes);
siteRouter.use('/api/errors', syserrorsRoutes);
siteRouter.use('/api/movements', movementsRoutes);
siteRouter.use('/api/earnings', earningsRoutes);
siteRouter.use('/api/materials', materialsRoutes);
siteRouter.use('/api/feedback', feedbackRoutes);
siteRouter.use('/api/api-management', apiManagementRoutes);
siteRouter.use('/api/public/v1', publicApiRoutes);
siteRouter.use('/api/barcode-disputes', barcodeDisputesRoutes);
const assemblyRoutes = require('./routes/assembly');
siteRouter.use('/api/assembly', assemblyRoutes);
siteRouter.use('/api/uploads', express.static(path.join(__dirname, '../uploads')));
siteRouter.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve frontend in production
const frontendDist = path.join(__dirname, '../../frontend/dist');
// Assets (JS/CSS with hash) — cache aggressively. index.html — never cache.
siteRouter.use(express.static(frontendDist, {
  maxAge: '1d',
  immutable: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
siteRouter.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(frontendDist, 'index.html'));
});

if (config.appBasePath) {
  app.use(config.appBasePath, siteRouter);
} else {
  app.use(siteRouter);
}

module.exports = app;
