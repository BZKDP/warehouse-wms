const pool = require('./pool');
const { applySharedBarcodeExceptions } = require('../utils/sharedBarcodes');
const { KNOWN_BARCODE_DISPUTES } = require('../utils/barcodeDisputeSeeds');

async function createSchema(attempt = 1) {
  const client = await pool.connect();
  try {
    // Advisory lock to prevent deadlocks during concurrent migrations
    await client.query('SELECT pg_advisory_lock(42)');
    await client.query('BEGIN');

    // ─── Users & Employees ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees_s (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(255),
        phone VARCHAR(50),
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users_s (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
        employee_id INTEGER REFERENCES employees_s(id) ON DELETE SET NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Add password_plain and widen role check
    await client.query(`ALTER TABLE users_s ADD COLUMN IF NOT EXISTS password_plain VARCHAR(255)`);
    await client.query(`ALTER TABLE users_s ADD COLUMN IF NOT EXISTS role_id INTEGER`);
    await client.query(`ALTER TABLE users_s DROP CONSTRAINT IF EXISTS users_c_role_check`);
    // Линк на общую users_d (таблица сайта сотрудников). Auth читает пароль
    // из users_d, но req.user.id остаётся users_s.id для совместимости с FK
    // на users_s.id (created_by, performed_by и т.д. — 11 таблиц).
    await client.query(`ALTER TABLE users_s ADD COLUMN IF NOT EXISTS users_d_id INTEGER`);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_s_users_d_id_fkey') THEN
          ALTER TABLE users_s ADD CONSTRAINT users_s_users_d_id_fkey
            FOREIGN KEY (users_d_id) REFERENCES users_d(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_s_users_d_id ON users_s(users_d_id) WHERE users_d_id IS NOT NULL`);

    // Add shelf_id to scans for multi-shelf tracking
    await client.query(`ALTER TABLE inventory_task_scans_s ADD COLUMN IF NOT EXISTS shelf_id INTEGER`);

    // Add 'paused' status to inventory_tasks_s
    await client.query(`ALTER TABLE inventory_tasks_s DROP CONSTRAINT IF EXISTS inventory_tasks_s_status_check`);
    await client.query(`ALTER TABLE inventory_tasks_s DROP CONSTRAINT IF EXISTS inventory_tasks_c_status_check`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD CONSTRAINT inventory_tasks_s_status_check CHECK (status IN ('new', 'in_progress', 'completed', 'cancelled', 'paused'))`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS paused_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS pause_log JSONB DEFAULT '[]'`);

    // Soft delete for tasks
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON inventory_tasks_s (deleted_at) WHERE deleted_at IS NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_status_deleted ON inventory_tasks_s (status, deleted_at) WHERE deleted_at IS NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON inventory_tasks_s (created_at DESC) WHERE deleted_at IS NULL`);

    // User activity tracking
    await client.query(`ALTER TABLE users_s ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ`);

    // Отзыв сессий: все JWT, выданные ДО этой отметки, считаются недействительными.
    // Глобальный аналог — settings_s.sessions_valid_after (выкидывает вообще всех).
    await client.query(`ALTER TABLE users_s ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ`);

    // Warehouse sort order
    await client.query(`ALTER TABLE warehouses_s ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);

    // Earnings performance indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_employee_created ON employee_earnings_s (employee_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_created ON employee_earnings_s (created_at DESC)`);

    // Multi-shelf support for inventory tasks
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS shelf_ids JSONB`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS current_shelf_index INTEGER DEFAULT 0`);

    // ─── Product Catalog ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_folders_s (
        id SERIAL PRIMARY KEY,
        external_id VARCHAR(255) UNIQUE,
        name VARCHAR(500) NOT NULL,
        parent_id INTEGER REFERENCES product_folders_s(id) ON DELETE SET NULL,
        full_path TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products_s (
        id SERIAL PRIMARY KEY,
        external_id VARCHAR(255) UNIQUE,
        name VARCHAR(500) NOT NULL,
        code VARCHAR(255),
        article VARCHAR(255),
        entity_type VARCHAR(20) NOT NULL DEFAULT 'product' CHECK (entity_type IN ('product', 'bundle')),
        barcode_list TEXT,
        production_barcode VARCHAR(255),
        marketplace_barcodes_json JSONB,
        stock NUMERIC(15,3) DEFAULT 0,
        reserve NUMERIC(15,3) DEFAULT 0,
        in_transit NUMERIC(15,3) DEFAULT 0,
        quantity NUMERIC(15,3) DEFAULT 0,
        folder_id INTEGER REFERENCES product_folders_s(id) ON DELETE SET NULL,
        folder_path TEXT,
        archived BOOLEAN NOT NULL DEFAULT false,
        source_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE products_s ADD COLUMN IF NOT EXISTS sale_price NUMERIC(18,2)`);
    await client.query(`ALTER TABLE products_s ADD COLUMN IF NOT EXISTS cost_price NUMERIC(18,2)`);
    await client.query(`ALTER TABLE products_s ADD COLUMN IF NOT EXISTS honest_sign BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE products_s ADD COLUMN IF NOT EXISTS notes TEXT`);
    await client.query(`ALTER TABLE products_s ADD COLUMN IF NOT EXISTS manually_archived BOOLEAN NOT NULL DEFAULT false`);
    // Доп. названия (синонимы) — ИИ ищет и по ним. Несколько через перевод строки / «;».
    await client.query(`ALTER TABLE products_s ADD COLUMN IF NOT EXISTS alt_names TEXT`);
    // Внутренний тип ИЗ, к которому относится конкретная карточка товара.
    await client.query(`ALTER TABLE products_s ADD COLUMN IF NOT EXISTS iz_type TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS archived_products_s (
        id BIGSERIAL PRIMARY KEY,
        original_product_id INTEGER NOT NULL UNIQUE,
        external_id VARCHAR(255),
        name VARCHAR(500) NOT NULL,
        code VARCHAR(255),
        article VARCHAR(255),
        entity_type VARCHAR(20) NOT NULL,
        product_snapshot JSONB NOT NULL,
        archive_source VARCHAR(50) NOT NULL DEFAULT 'manual',
        archive_reason TEXT,
        archived_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archived_products_s_archived_at ON archived_products_s(archived_at DESC)`);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_c_name ON products_s(name);
      CREATE INDEX IF NOT EXISTS idx_products_c_code ON products_s(code);
      CREATE INDEX IF NOT EXISTS idx_products_c_external_id ON products_s(external_id);
      CREATE INDEX IF NOT EXISTS idx_products_c_entity_type ON products_s(entity_type);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bundle_components_s (
        id SERIAL PRIMARY KEY,
        bundle_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        component_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL,
        component_external_id VARCHAR(255),
        quantity NUMERIC(15,3) NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(bundle_id, component_id)
      )
    `);

    // ─── Raw Materials (ingredients & packaging) ───────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS raw_materials_s (
        id SERIAL PRIMARY KEY,
        external_id VARCHAR(255) UNIQUE,
        name VARCHAR(500) NOT NULL,
        code VARCHAR(255),
        article VARCHAR(255),
        unit VARCHAR(20) DEFAULT 'шт',
        category VARCHAR(30) NOT NULL DEFAULT 'ingredient' CHECK (category IN ('ingredient', 'packaging')),
        folder_path TEXT,
        stock NUMERIC(15,3) DEFAULT 0,
        archived BOOLEAN NOT NULL DEFAULT false,
        source_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_materials_c_external_id ON raw_materials_s(external_id);
      CREATE INDEX IF NOT EXISTS idx_raw_materials_c_name ON raw_materials_s(name);
      CREATE INDEX IF NOT EXISTS idx_raw_materials_c_category ON raw_materials_s(category);
    `);

    // Migrations for raw_materials_s
    await client.query(`ALTER TABLE raw_materials_s ADD COLUMN IF NOT EXISTS buy_price NUMERIC(18,2)`);
    await client.query(`ALTER TABLE raw_materials_s ADD COLUMN IF NOT EXISTS min_stock NUMERIC(15,3) DEFAULT 0`);
    await client.query(`ALTER TABLE raw_materials_s ADD COLUMN IF NOT EXISTS supplier VARCHAR(500)`);
    await client.query(`ALTER TABLE raw_materials_s ADD COLUMN IF NOT EXISTS notes TEXT`);
    await client.query(`ALTER TABLE raw_materials_s ADD COLUMN IF NOT EXISTS material_group VARCHAR(50) DEFAULT 'другое'`);

    // ─── Material Recipe (what a material consists of) ─────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS material_recipe_s (
        id SERIAL PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES raw_materials_s(id) ON DELETE CASCADE,
        ingredient_id INTEGER NOT NULL REFERENCES raw_materials_s(id) ON DELETE CASCADE,
        quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(material_id, ingredient_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_material_recipe_c_mat ON material_recipe_s(material_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_material_recipe_c_ing ON material_recipe_s(ingredient_id)`);

    // ─── Tech Cards (production recipes) ───────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tech_cards_s (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        external_id VARCHAR(255) UNIQUE,
        name VARCHAR(500) NOT NULL,
        folder_path TEXT,
        output_quantity NUMERIC(15,3) DEFAULT 1,
        cost NUMERIC(18,2),
        archived BOOLEAN NOT NULL DEFAULT false,
        source_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_cards_c_product_id ON tech_cards_s(product_id);
      CREATE INDEX IF NOT EXISTS idx_tech_cards_c_external_id ON tech_cards_s(external_id);
    `);

    // ─── Tech Card Materials (recipe lines) ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tech_card_materials_s (
        id SERIAL PRIMARY KEY,
        tech_card_id INTEGER NOT NULL REFERENCES tech_cards_s(id) ON DELETE CASCADE,
        material_id INTEGER NOT NULL REFERENCES raw_materials_s(id) ON DELETE CASCADE,
        quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tech_card_id, material_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tech_card_materials_c_tech_card_id ON tech_card_materials_s(tech_card_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS import_runs_s (
        id SERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
        products_count INTEGER DEFAULT 0,
        bundles_count INTEGER DEFAULT 0,
        errors_json JSONB,
        source_dir TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      )
    `);

    // ─── Warehouse Structure ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouses_s (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        external_id VARCHAR(255),
        active BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS racks_s (
        id SERIAL PRIMARY KEY,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses_s(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        number INTEGER NOT NULL,
        code VARCHAR(50),
        barcode_value VARCHAR(255) UNIQUE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shelves_s (
        id SERIAL PRIMARY KEY,
        rack_id INTEGER NOT NULL REFERENCES racks_s(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        number INTEGER NOT NULL,
        code VARCHAR(50),
        barcode_value VARCHAR(255) UNIQUE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE shelves_s ADD COLUMN IF NOT EXISTS uses_boxes BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE shelves_s ADD COLUMN IF NOT EXISTS uses_loose BOOLEAN NOT NULL DEFAULT true`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shelf_items_s (
        id SERIAL PRIMARY KEY,
        shelf_id INTEGER NOT NULL REFERENCES shelves_s(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        updated_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(shelf_id, product_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shelf_movements_s (
        id SERIAL PRIMARY KEY,
        shelf_id INTEGER NOT NULL REFERENCES shelves_s(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL,
        operation_type VARCHAR(30) NOT NULL CHECK (operation_type IN ('inventory', 'correction', 'stock_in', 'stock_out')),
        quantity_before NUMERIC(15,3) NOT NULL DEFAULT 0,
        quantity_after NUMERIC(15,3) NOT NULL DEFAULT 0,
        quantity_delta NUMERIC(15,3) NOT NULL DEFAULT 0,
        user_id INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        task_id INTEGER,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Inventory Tasks ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_tasks_s (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed', 'cancelled')),
        employee_id INTEGER REFERENCES employees_s(id) ON DELETE SET NULL,
        shelf_id INTEGER REFERENCES shelves_s(id) ON DELETE SET NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_task_scans_s (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES inventory_tasks_s(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL,
        product_external_id VARCHAR(255),
        scanned_value VARCHAR(500) NOT NULL,
        quantity_delta NUMERIC(15,3) NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Scan Errors ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS scan_errors_s (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES inventory_tasks_s(id) ON DELETE SET NULL,
        scanned_value VARCHAR(500) NOT NULL,
        employee_note TEXT,
        user_id INTEGER REFERENCES users_s(id),
        resolved_at TIMESTAMPTZ,
        resolved_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Migration: add resolved columns if they don't exist (for existing tables)
    await client.query(`ALTER TABLE scan_errors_s ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE scan_errors_s ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL`);

    // ─── Performance indexes ─────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_scans_task_id ON inventory_task_scans_s(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_scans_task_product ON inventory_task_scans_s(task_id, product_id);
      CREATE INDEX IF NOT EXISTS idx_task_scans_task_box ON inventory_task_scans_s(task_box_id);
      CREATE INDEX IF NOT EXISTS idx_scan_errors_task_id ON scan_errors_s(task_id);
      CREATE INDEX IF NOT EXISTS idx_inv_tasks_status ON inventory_tasks_s(status);
      CREATE INDEX IF NOT EXISTS idx_inv_tasks_employee ON inventory_tasks_s(employee_id);
      CREATE INDEX IF NOT EXISTS idx_inv_tasks_shelf ON inventory_tasks_s(shelf_id);
      CREATE INDEX IF NOT EXISTS idx_inv_tasks_target_pallet ON inventory_tasks_s(target_pallet_id);
      CREATE INDEX IF NOT EXISTS idx_shelf_movements_shelf_created ON shelf_movements_s(shelf_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_shelf_items_product ON shelf_items_s(product_id);
      CREATE INDEX IF NOT EXISTS idx_boxes_pallet ON boxes_s(pallet_id);
      CREATE INDEX IF NOT EXISTS idx_boxes_task ON boxes_s(task_id);
      CREATE INDEX IF NOT EXISTS idx_boxes_status ON boxes_s(status);
      CREATE INDEX IF NOT EXISTS idx_shelf_boxes_shelf ON shelf_boxes_s(shelf_id);
      CREATE INDEX IF NOT EXISTS idx_box_items_box ON box_items_s(box_id);
      CREATE INDEX IF NOT EXISTS idx_shelf_box_items_shelf_box ON shelf_box_items_s(shelf_box_id);
      CREATE INDEX IF NOT EXISTS idx_pallet_items_pallet ON pallet_items_s(pallet_id);
      CREATE INDEX IF NOT EXISTS idx_employee_inventory_employee ON employee_inventory_s(employee_id);
    `);

    // External employee link
    await client.query(`ALTER TABLE employees_s ADD COLUMN IF NOT EXISTS external_employee_id INTEGER UNIQUE`);
    await client.query(`ALTER TABLE employees_s ADD COLUMN IF NOT EXISTS department VARCHAR(255)`);

    // ─── Settings ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings_s (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) NOT NULL UNIQUE,
        value TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Public API keys and request audit ───────────────────────────
    // Секрет ключа никогда не хранится открытым: только SHA-256 и короткий
    // публичный префикс, по которому оператор узнаёт ключ в журнале.
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys_s (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        key_prefix VARCHAR(64) NOT NULL UNIQUE,
        key_hash CHAR(64) NOT NULL UNIQUE,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        active BOOLEAN NOT NULL DEFAULT true,
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 120,
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        last_used_ip VARCHAR(100),
        created_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        revoked_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT api_keys_s_rate_limit_check
          CHECK (rate_limit_per_minute BETWEEN 1 AND 5000),
        CONSTRAINT api_keys_s_scopes_array_check
          CHECK (jsonb_typeof(scopes) = 'array')
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_s_active ON api_keys_s(active) WHERE active`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_s_last_used ON api_keys_s(last_used_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS api_request_logs_s (
        id BIGSERIAL PRIMARY KEY,
        api_key_id BIGINT REFERENCES api_keys_s(id) ON DELETE SET NULL,
        key_prefix VARCHAR(64),
        request_id VARCHAR(64),
        operation VARCHAR(160),
        method VARCHAR(12) NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        duration_ms NUMERIC(12,2),
        ip_address VARCHAR(100),
        user_agent TEXT,
        request_body JSONB,
        error_code VARCHAR(120),
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_api_logs_s_created ON api_request_logs_s(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_api_logs_s_key_created ON api_request_logs_s(api_key_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_api_logs_s_status_created ON api_request_logs_s(status_code, created_at DESC)`);

    // ─── Очередь спорных штрихкодов и решений ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS barcode_disputes_s (
        id BIGSERIAL PRIMARY KEY,
        issue_key VARCHAR(255) NOT NULL UNIQUE,
        issue_type VARCHAR(40) NOT NULL CHECK (issue_type IN ('barcode_owner', 'production_barcode', 'product_status')),
        severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
        subject_article VARCHAR(255),
        primary_barcode VARCHAR(255),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        candidate_options JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(candidate_options) = 'array'),
        evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
        recommended_option_id VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'resolved', 'dismissed')),
        selected_option JSONB,
        applied BOOLEAN NOT NULL DEFAULT false,
        resolution_note TEXT,
        detected_by VARCHAR(100) NOT NULL DEFAULT 'manual',
        created_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        resolved_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_barcode_disputes_status ON barcode_disputes_s(status, severity, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_barcode_disputes_barcode ON barcode_disputes_s(primary_barcode) WHERE primary_barcode IS NOT NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS barcode_ownership_s (
        barcode VARCHAR(255) PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        dispute_id BIGINT REFERENCES barcode_disputes_s(id) ON DELETE SET NULL,
        assigned_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_barcode_ownership_product ON barcode_ownership_s(product_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS barcode_dispute_events_s (
        id BIGSERIAL PRIMARY KEY,
        dispute_id BIGINT NOT NULL REFERENCES barcode_disputes_s(id) ON DELETE CASCADE,
        event_type VARCHAR(40) NOT NULL,
        user_id INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_barcode_dispute_events_issue ON barcode_dispute_events_s(dispute_id, created_at DESC)`);

    for (const issue of KNOWN_BARCODE_DISPUTES) {
      await client.query(`
        INSERT INTO barcode_disputes_s
          (issue_key, issue_type, severity, subject_article, primary_barcode,
           title, description, candidate_options, evidence,
           recommended_option_id, detected_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,'audit_2026_08_26')
        ON CONFLICT (issue_key) DO UPDATE SET
          issue_type = EXCLUDED.issue_type,
          severity = EXCLUDED.severity,
          subject_article = EXCLUDED.subject_article,
          primary_barcode = EXCLUDED.primary_barcode,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          candidate_options = EXCLUDED.candidate_options,
          evidence = EXCLUDED.evidence,
          recommended_option_id = EXCLUDED.recommended_option_id,
          updated_at = NOW()
        WHERE barcode_disputes_s.status IN ('open', 'decided')
      `, [
        issue.issueKey, issue.issueType, issue.severity,
        issue.subjectArticle || null, issue.primaryBarcode || null,
        issue.title, issue.description,
        JSON.stringify(issue.options), JSON.stringify(issue.evidence),
        issue.recommendedOptionId || null,
      ]);
    }

    // ─── Updated_at triggers ─────────────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_s()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    const tablesWithUpdatedAt = [
      'employees_s', 'users_s', 'product_folders_s', 'products_s',
      'warehouses_s', 'racks_s', 'shelves_s', 'inventory_tasks_s', 'settings_s',
      'raw_materials_s', 'tech_cards_s'
    ];

    for (const table of tablesWithUpdatedAt) {
      await client.query(`
        DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table};
        CREATE TRIGGER trg_${table}_updated_at
          BEFORE UPDATE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_s();
      `);
    }

    // ─── System / Frontend Error Log ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_errors_s (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        username       VARCHAR(100),
        user_role      VARCHAR(20),
        error_type     VARCHAR(30) NOT NULL DEFAULT 'unknown',
        error_message  TEXT,
        error_stack    TEXT,
        page_url       TEXT,
        component      VARCHAR(255),
        http_status    INTEGER,
        request_url    TEXT,
        request_method VARCHAR(10),
        response_data  TEXT,
        browser_info   TEXT,
        extra_json     JSONB,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_system_errors_c_created ON system_errors_s(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_system_errors_c_type    ON system_errors_s(error_type)`);

    // ─── Feedback ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback_s (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        username VARCHAR(100),
        user_role VARCHAR(20),
        category VARCHAR(30) NOT NULL DEFAULT 'bug',
        subcategory VARCHAR(50),
        description TEXT,
        transcript TEXT,
        screenshot_path VARCHAR(500),
        audio_path VARCHAR(500),
        page_url TEXT,
        browser_info TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        admin_notes TEXT,
        resolved_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_s(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_s(status)`);
    await client.query(`
      DROP TRIGGER IF EXISTS trg_feedback_s_updated_at ON feedback_s;
      CREATE TRIGGER trg_feedback_s_updated_at
        BEFORE UPDATE ON feedback_s
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_s();
    `);

    // ─── Migrations ──────────────────────────────────────────────────

    // Allow 'manager' role
    await client.query(`ALTER TABLE users_s DROP CONSTRAINT IF EXISTS users_c_role_check`);
    await client.query(`ALTER TABLE users_s ADD CONSTRAINT users_c_role_check CHECK (role IN ('admin', 'manager', 'employee'))`);

    // Warehouse type for FBO support
    await client.query(`ALTER TABLE warehouses_s ADD COLUMN IF NOT EXISTS warehouse_type VARCHAR(20) NOT NULL DEFAULT 'fbs'`);
    await client.query(`ALTER TABLE warehouses_s ALTER COLUMN warehouse_type TYPE VARCHAR(20)`);
    await client.query(`ALTER TABLE warehouses_s ADD COLUMN IF NOT EXISTS exclude_from_suggestions BOOLEAN NOT NULL DEFAULT false`);

    // FBO: Rows (analogous to racks)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pallet_rows_s (
        id SERIAL PRIMARY KEY,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses_s(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(warehouse_id, number)
      )
    `);

    // FBO: Pallets (analogous to shelves)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pallets_s (
        id SERIAL PRIMARY KEY,
        row_id INTEGER NOT NULL REFERENCES pallet_rows_s(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        barcode_value VARCHAR(255) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(row_id, number)
      )
    `);

    // FBO: Boxes (physical boxes with barcodes stored on pallets)
    await client.query(`
      CREATE TABLE IF NOT EXISTS boxes_s (
        id SERIAL PRIMARY KEY,
        barcode_value VARCHAR(255) NOT NULL UNIQUE,
        product_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL,
        pallet_id INTEGER REFERENCES pallets_s(id) ON DELETE SET NULL,
        task_id INTEGER REFERENCES inventory_tasks_s(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        box_size INTEGER NOT NULL DEFAULT 50,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ
      )
    `);

    // Add packaging columns to inventory_tasks_s
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) NOT NULL DEFAULT 'inventory'`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS box_size INTEGER DEFAULT 50`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS target_pallet_id INTEGER REFERENCES pallets_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS packing_phase VARCHAR(20) DEFAULT 'packaging'`);

    // Add confirmed column to boxes_s
    await client.query(`ALTER TABLE boxes_s ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS target_box_id INTEGER REFERENCES boxes_s(id) ON DELETE SET NULL`);

    // Mark remainder boxes (not placed on FBO pallet, transferred to FBS shelf instead)
    await client.query(`ALTER TABLE boxes_s ADD COLUMN IF NOT EXISTS is_remainder BOOLEAN NOT NULL DEFAULT false`);
    // Store which FBS shelf the remainder went to
    await client.query(`ALTER TABLE boxes_s ADD COLUMN IF NOT EXISTS remainder_shelf_id INTEGER REFERENCES shelves_s(id) ON DELETE SET NULL`);

    // Pallet: uses_boxes flag (true = товар в коробках, false = товар напрямую)
    await client.query(`ALTER TABLE pallets_s ADD COLUMN IF NOT EXISTS uses_boxes BOOLEAN NOT NULL DEFAULT true`);

    // Warehouse types
    await client.query(`ALTER TABLE warehouses_s DROP CONSTRAINT IF EXISTS warehouses_c_warehouse_type_check`);
    await client.query(`ALTER TABLE warehouses_s ADD CONSTRAINT warehouses_c_warehouse_type_check CHECK (warehouse_type IN ('fbs', 'fbo', 'both', 'visual', 'visual_pallet', 'box'))`);

    // boxes_s: warehouse_id for box-type warehouses (boxes without pallets)
    await client.query(`ALTER TABLE boxes_s ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE boxes_s ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);

    // shelf_boxes_s: physical boxes on FBS shelves (for visual/experimental warehouses)
    await client.query(`
      CREATE TABLE IF NOT EXISTS shelf_boxes_s (
        id SERIAL PRIMARY KEY,
        shelf_id INTEGER NOT NULL REFERENCES shelves_s(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 1,
        name VARCHAR(100),
        barcode_value VARCHAR(255) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(shelf_id, position)
      )
    `);
    await client.query(`ALTER TABLE shelf_boxes_s ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE shelf_boxes_s ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES inventory_tasks_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE shelf_boxes_s ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE shelf_boxes_s ADD COLUMN IF NOT EXISTS box_size INTEGER NOT NULL DEFAULT 50`);
    await client.query(`ALTER TABLE shelf_boxes_s ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'closed'`);
    await client.query(`ALTER TABLE shelf_boxes_s ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE shelf_boxes_s ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS target_shelf_box_id INTEGER REFERENCES shelf_boxes_s(id) ON DELETE SET NULL`);

    // Multi-product contents for pallet boxes
    await client.query(`
      CREATE TABLE IF NOT EXISTS box_items_s (
        id SERIAL PRIMARY KEY,
        box_id INTEGER NOT NULL REFERENCES boxes_s(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(box_id, product_id)
      )
    `);

    // Multi-product contents for shelf boxes
    await client.query(`
      CREATE TABLE IF NOT EXISTS shelf_box_items_s (
        id SERIAL PRIMARY KEY,
        shelf_box_id INTEGER NOT NULL REFERENCES shelf_boxes_s(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(shelf_box_id, product_id)
      )
    `);

    // One inventory task can now include multiple boxes processed one by one
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_task_boxes_s (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES inventory_tasks_s(id) ON DELETE CASCADE,
        box_id INTEGER REFERENCES boxes_s(id) ON DELETE CASCADE,
        shelf_box_id INTEGER REFERENCES shelf_boxes_s(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT inventory_task_boxes_target_check CHECK (
          (box_id IS NOT NULL AND shelf_box_id IS NULL)
          OR (box_id IS NULL AND shelf_box_id IS NOT NULL)
        )
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_task_boxes_unique_box ON inventory_task_boxes_s(task_id, box_id) WHERE box_id IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_task_boxes_unique_shelf_box ON inventory_task_boxes_s(task_id, shelf_box_id) WHERE shelf_box_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_task_boxes_task_sort ON inventory_task_boxes_s(task_id, sort_order)`);

    await client.query(`ALTER TABLE inventory_task_scans_s ADD COLUMN IF NOT EXISTS task_box_id INTEGER REFERENCES inventory_task_boxes_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE scan_errors_s ADD COLUMN IF NOT EXISTS task_box_id INTEGER REFERENCES inventory_task_boxes_s(id) ON DELETE SET NULL`);

    // ─── Employee Earnings / GRAcoin ────────────────────────────────
    await client.query(`ALTER TABLE employees_s ADD COLUMN IF NOT EXISTS gra_balance NUMERIC(18,3) NOT NULL DEFAULT 0`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_earnings_s (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees_s(id) ON DELETE CASCADE,
        task_id INTEGER REFERENCES inventory_tasks_s(id) ON DELETE SET NULL,
        task_scan_id INTEGER REFERENCES inventory_task_scans_s(id) ON DELETE SET NULL,
        task_box_id INTEGER REFERENCES inventory_task_boxes_s(id) ON DELETE SET NULL,
        shelf_id INTEGER REFERENCES shelves_s(id) ON DELETE SET NULL,
        box_id INTEGER REFERENCES boxes_s(id) ON DELETE SET NULL,
        shelf_box_id INTEGER REFERENCES shelf_boxes_s(id) ON DELETE SET NULL,
        product_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL,
        event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('inventory_scan', 'manual_adjustment')),
        reward_units NUMERIC(15,3) NOT NULL DEFAULT 1,
        rate_per_unit NUMERIC(18,3) NOT NULL DEFAULT 0,
        amount_delta NUMERIC(18,3) NOT NULL,
        balance_before NUMERIC(18,3) NOT NULL DEFAULT 0,
        balance_after NUMERIC(18,3) NOT NULL DEFAULT 0,
        notes TEXT,
        created_by_user_id INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_earnings_employee_created ON employee_earnings_s(employee_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_earnings_task ON employee_earnings_s(task_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_earnings_event_type ON employee_earnings_s(event_type)`);
    // Covering index for /earnings/employees aggregation query
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_earnings_agg ON employee_earnings_s(employee_id, event_type, source) INCLUDE (amount_delta, reward_units, task_id, created_at)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_earnings_unique_scan ON employee_earnings_s(task_scan_id) WHERE task_scan_id IS NOT NULL`);
    // FK по полкам/коробкам — нужны для каскадного удаления (таблица >1M строк, иначе Seq Scan → таймаут)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_shelf_id ON employee_earnings_s(shelf_id) WHERE shelf_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_shelf_box_id ON employee_earnings_s(shelf_box_id) WHERE shelf_box_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_box_id ON employee_earnings_s(box_id) WHERE box_id IS NOT NULL`);

    // External earnings fields (sborka site)
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS task_title VARCHAR(500)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS task_type VARCHAR(30)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source VARCHAR(50)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_marketplace VARCHAR(50)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_store_id VARCHAR(100)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_store_name VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_entity_type VARCHAR(50)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_entity_id VARCHAR(100)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_entity_name VARCHAR(500)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_article VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_product_name VARCHAR(500)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_marketplace_code VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_scanned_code VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_task_id VARCHAR(100)`);
    // Expand event_type constraint
    // Drop ALL possible constraint names for event_type
    await client.query(`ALTER TABLE employee_earnings_s DROP CONSTRAINT IF EXISTS employee_earnings_s_event_type_check`);
    await client.query(`ALTER TABLE employee_earnings_s DROP CONSTRAINT IF EXISTS employee_earnings_c_event_type_check`);
    // Find and drop by querying pg_constraint
    await client.query(`
      DO $$ DECLARE cname text;
      BEGIN
        SELECT conname INTO cname FROM pg_constraint
        WHERE conrelid = 'employee_earnings_s'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%event_type%';
        IF cname IS NOT NULL THEN EXECUTE 'ALTER TABLE employee_earnings_s DROP CONSTRAINT ' || cname; END IF;
      END $$
    `);
    await client.query(`ALTER TABLE employee_earnings_s ADD CONSTRAINT employee_earnings_s_event_type_check CHECK (event_type IN ('inventory_scan', 'manual_adjustment', 'external_order_pick', 'external_order_collect'))`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_earnings_source ON employee_earnings_s(source) WHERE source IS NOT NULL`);

    // Split-roles fields (sborka contract 2026-04-20): picker/packer identity,
    // session tracking, redistribute-safe dedup. Только ALTER COLUMN здесь —
    // безопасно, не конфликтует с существующими объектами прод-БД.
    // Индексы и sborka_live_events_s заведём отдельной миграцией после аудита
    // прод-схемы (sborka пишет в sborka_live_events_s напрямую, таблица уже
    // есть на проде с возможно другой сигнатурой).
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_session_id VARCHAR(100)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_item_id VARCHAR(100)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_item_key VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_order_ref VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_earnings_s ADD COLUMN IF NOT EXISTS source_marketplace_code_kind VARCHAR(50)`);

    // Performance indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shelf_items_shelf_qty ON shelf_items_s(shelf_id, product_id) WHERE quantity > 0`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shelf_box_items_product ON shelf_box_items_s(product_id) WHERE quantity > 0`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_box_items_product ON box_items_s(product_id) WHERE quantity > 0`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pallet_items_product ON pallet_items_s(product_id) WHERE quantity > 0`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_performed_by ON movements_s(performed_by)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_type_created ON movements_s(movement_type, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_task_scans_created ON inventory_task_scans_s(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_tasks_created ON inventory_tasks_s(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_racks_warehouse ON racks_s(warehouse_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pallet_rows_warehouse ON pallet_rows_s(warehouse_id)`);

    // Increase precision for GRA fields (3 → 6 decimal places)
    try {
      await client.query(`ALTER TABLE employees_s ALTER COLUMN gra_balance TYPE NUMERIC(18,6)`);
      await client.query(`ALTER TABLE employee_earnings_s ALTER COLUMN rate_per_unit TYPE NUMERIC(18,6)`);
      await client.query(`ALTER TABLE employee_earnings_s ALTER COLUMN amount_delta TYPE NUMERIC(18,6)`);
      await client.query(`ALTER TABLE employee_earnings_s ALTER COLUMN balance_before TYPE NUMERIC(18,6)`);
      await client.query(`ALTER TABLE employee_earnings_s ALTER COLUMN balance_after TYPE NUMERIC(18,6)`);
      await client.query(`ALTER TABLE employee_earnings_s ALTER COLUMN reward_units TYPE NUMERIC(15,6)`);
    } catch (e) { console.log('[DB] GRA precision migration already done or skipped:', e.message); }

    // Seed new item tables from legacy one-product boxes
    await client.query(`
      INSERT INTO box_items_s (box_id, product_id, quantity, updated_at)
      SELECT b.id, b.product_id, b.quantity, NOW()
      FROM boxes_s b
      WHERE b.product_id IS NOT NULL
        AND b.quantity > 0
        AND NOT EXISTS (
          SELECT 1 FROM box_items_s bi WHERE bi.box_id = b.id AND bi.product_id = b.product_id
        )
    `);
    await client.query(`
      INSERT INTO shelf_box_items_s (shelf_box_id, product_id, quantity, updated_at)
      SELECT sb.id, sb.product_id, sb.quantity, NOW()
      FROM shelf_boxes_s sb
      WHERE sb.product_id IS NOT NULL
        AND sb.quantity > 0
        AND NOT EXISTS (
          SELECT 1 FROM shelf_box_items_s sbi WHERE sbi.shelf_box_id = sb.id AND sbi.product_id = sb.product_id
        )
    `);

    // Repair: для односоставных коробок (где в box_items_s ровно одна строка
    // с тем же product_id что и в boxes_s) синхронизируем box_items_s.quantity
    // → boxes_s.quantity. Лечит застарелую рассинхронизацию, когда старый
    // packing.js обновлял только boxes_s.quantity, а box_items_s оставалась
    // со стоячим (часто нулевым) значением, и сборка показывала неверное
    // количество / "коробка пустая".
    await client.query(`
      UPDATE box_items_s bi
      SET quantity = b.quantity, updated_at = NOW()
      FROM boxes_s b
      WHERE bi.box_id = b.id
        AND b.product_id IS NOT NULL
        AND b.product_id = bi.product_id
        AND bi.quantity <> b.quantity
        AND (SELECT COUNT(*) FROM box_items_s bii WHERE bii.box_id = b.id) = 1
    `);
    await client.query(`
      UPDATE shelf_box_items_s sbi
      SET quantity = sb.quantity, updated_at = NOW()
      FROM shelf_boxes_s sb
      WHERE sbi.shelf_box_id = sb.id
        AND sb.product_id IS NOT NULL
        AND sb.product_id = sbi.product_id
        AND sbi.quantity <> sb.quantity
        AND (SELECT COUNT(*) FROM shelf_box_items_s sbii WHERE sbii.shelf_box_id = sb.id) = 1
    `);

    // Visual warehouse seed removed — create warehouses manually via UI

    // Fix old-format barcodes (SHELF-X-Y, RACK-X-Y) → use shelf/rack ID for uniqueness
    await client.query(`
      UPDATE shelves_s
      SET barcode_value = (200000000 + id)::text
      WHERE barcode_value ~ '^SHELF-'
    `);
    await client.query(`
      UPDATE racks_s
      SET barcode_value = (100000 + id)::text
      WHERE barcode_value ~ '^RACK-'
    `);

    // Shared-ШК исключения (один ШК на нескольких товарах) —
    // см. utils/sharedBarcodes.js
    await applySharedBarcodeExceptions(client);

    // ─── Pallet items (loose products on pallets, like shelf_items_s) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS pallet_items_s (
        id SERIAL PRIMARY KEY,
        pallet_id INTEGER NOT NULL REFERENCES pallets_s(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(pallet_id, product_id)
      )
    `);

    // ─── Employee inventory (what employees are holding) ─────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_inventory_s (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees_s(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products_s(id) ON DELETE CASCADE,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(employee_id, product_id)
      )
    `);

    // ─── Universal movement log ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS movements_s (
        id SERIAL PRIMARY KEY,
        movement_type VARCHAR(30) NOT NULL,
        product_id INTEGER REFERENCES products_s(id) ON DELETE SET NULL,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        from_pallet_id INTEGER REFERENCES pallets_s(id) ON DELETE SET NULL,
        from_shelf_id INTEGER REFERENCES shelves_s(id) ON DELETE SET NULL,
        from_box_id INTEGER REFERENCES boxes_s(id) ON DELETE SET NULL,
        from_employee_id INTEGER REFERENCES employees_s(id) ON DELETE SET NULL,
        to_pallet_id INTEGER REFERENCES pallets_s(id) ON DELETE SET NULL,
        to_shelf_id INTEGER REFERENCES shelves_s(id) ON DELETE SET NULL,
        to_box_id INTEGER REFERENCES boxes_s(id) ON DELETE SET NULL,
        to_employee_id INTEGER REFERENCES employees_s(id) ON DELETE SET NULL,
        performed_by INTEGER REFERENCES users_s(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_c_created ON movements_s(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_c_product ON movements_s(product_id)`);
    // Add source column and widen movement_type if needed
    await client.query(`ALTER TABLE movements_s ADD COLUMN IF NOT EXISTS source VARCHAR(50)`);
    await client.query(`ALTER TABLE movements_s ALTER COLUMN movement_type TYPE VARCHAR(100)`);
    await client.query(`ALTER TABLE movements_s ADD COLUMN IF NOT EXISTS quantity_before NUMERIC(15,3)`);
    await client.query(`ALTER TABLE movements_s ADD COLUMN IF NOT EXISTS quantity_after NUMERIC(15,3)`);
    // Source of change: scan, manual_edit, task, admin, packaging
    await client.query(`ALTER TABLE movements_s ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual_edit'`);
    await client.query(`ALTER TABLE shelf_movements_s ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual_edit'`);

    // shelf_box_id columns for tracking box-level movements
    await client.query(`ALTER TABLE movements_s ADD COLUMN IF NOT EXISTS from_shelf_box_id INTEGER REFERENCES shelf_boxes_s(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE movements_s ADD COLUMN IF NOT EXISTS to_shelf_box_id INTEGER REFERENCES shelf_boxes_s(id) ON DELETE SET NULL`);
    // Indexes for fast lookups by box/pallet/shelf_box
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_s_from_box ON movements_s(from_box_id) WHERE from_box_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_s_to_box ON movements_s(to_box_id) WHERE to_box_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_s_from_shelf_box ON movements_s(from_shelf_box_id) WHERE from_shelf_box_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_s_to_shelf_box ON movements_s(to_shelf_box_id) WHERE to_shelf_box_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_s_from_pallet ON movements_s(from_pallet_id) WHERE from_pallet_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_s_to_pallet ON movements_s(to_pallet_id) WHERE to_pallet_id IS NOT NULL`);
    // FK по полкам — нужны для каскадного удаления полок/складов (иначе Seq Scan)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_from_shelf ON movements_s(from_shelf_id) WHERE from_shelf_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_to_shelf ON movements_s(to_shelf_id) WHERE to_shelf_id IS NOT NULL`);

    // ─── Roles ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles_s (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        permissions JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE users_s ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles_s(id) ON DELETE SET NULL`);

    // Seed default roles only if table is empty (so deleted roles stay deleted)
    const rolesExist = await client.query('SELECT COUNT(*) FROM roles_s');
    if (parseInt(rolesExist.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO roles_s (name, permissions) VALUES
          ('Администратор', '["dashboard","products.view","products.edit","warehouse.view","warehouse.edit","tasks.view","tasks.create","tasks.execute","staff.view","staff.edit","movements.view","movements.edit","settings","analytics","errors","roles.manage"]'),
          ('Менеджер', '["dashboard","products.view","warehouse.view","tasks.view","tasks.create","staff.view","movements.view","analytics","errors"]'),
          ('Сотрудник', '["tasks.execute","movements.edit"]')
      `);
    }
    // Новая возможность добавляется и в уже существующие стандартные роли.
    await client.query(`
      UPDATE roles_s
         SET permissions = permissions || '["barcode_disputes.view"]'::jsonb
       WHERE name IN ('Администратор', 'Менеджер')
         AND NOT permissions @> '["barcode_disputes.view"]'::jsonb
    `);
    await client.query(`
      UPDATE roles_s
         SET permissions = permissions || '["barcode_disputes.resolve"]'::jsonb
       WHERE name = 'Администратор'
         AND NOT permissions @> '["barcode_disputes.resolve"]'::jsonb
    `);

    // ─── Bundle Assembly ────────────────────────────────────────────
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS bundle_product_id INTEGER REFERENCES products_s(id)`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS bundle_qty INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS assembly_phase VARCHAR(20) DEFAULT 'picking'`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS source_boxes JSONB`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS dest_shelf_id INTEGER REFERENCES shelves_s(id)`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS dest_pallet_id INTEGER REFERENCES pallets_s(id)`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS assembled_count INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS placed_count INTEGER DEFAULT 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS assembly_items_s (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES inventory_tasks_s(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products_s(id),
        source_box_id INTEGER REFERENCES boxes_s(id),
        source_pallet_id INTEGER REFERENCES pallets_s(id),
        source_shelf_id INTEGER REFERENCES shelves_s(id),
        scanned_barcode VARCHAR(500),
        quantity NUMERIC(15,3) DEFAULT 1,
        used_in_bundle INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE assembly_items_s ADD COLUMN IF NOT EXISTS source_shelf_id INTEGER REFERENCES shelves_s(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assembly_items_task ON assembly_items_s(task_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assembly_items_bundle ON assembly_items_s(task_id, used_in_bundle)`);

    // ─── Denormalized scan count on tasks ──────────────────────────
    await client.query(`ALTER TABLE inventory_tasks_s ADD COLUMN IF NOT EXISTS scans_count INTEGER NOT NULL DEFAULT 0`);
    await client.query(`
      UPDATE inventory_tasks_s t SET scans_count = sub.cnt
      FROM (SELECT task_id, COUNT(*) as cnt FROM inventory_task_scans_s WHERE product_id IS NOT NULL GROUP BY task_id) sub
      WHERE sub.task_id = t.id AND t.scans_count = 0
    `);

    // ─── Performance indexes ─────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_tasks_employee_status ON inventory_tasks_s(employee_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_tasks_employee_completed ON inventory_tasks_s(employee_id, completed_at DESC) WHERE completed_at IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_task_boxes_task_status ON inventory_task_boxes_s(task_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_emp_date_type ON employee_earnings_s(employee_id, event_type, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_task_scans_task_created ON inventory_task_scans_s(task_id, created_at DESC)`);

    // ─── One-time: clear test GRACoin data ──────────────────────────
    const graCleared = await client.query(`SELECT value FROM settings_s WHERE key = 'gra_test_data_cleared' LIMIT 1`);
    if (!graCleared.rows.length) {
      console.log('[DB] Clearing test GRACoin data...');
      await client.query(`DELETE FROM employee_earnings_s`);
      await client.query(`UPDATE employees_s SET gra_balance = 0`);
      await client.query(`INSERT INTO settings_s (key, value) VALUES ('gra_test_data_cleared', 'true') ON CONFLICT (key) DO NOTHING`);
      console.log('[DB] Test GRACoin data cleared');
    }

    // ─── Additional performance indexes ──────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_to_emp_product ON movements_s(to_employee_id, product_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_emp_created ON employee_earnings_s(employee_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_tasks_employee_created ON inventory_tasks_s(employee_id, created_at DESC)`);

    // ─── FK constraint for shelf_movements_s.task_id (safe — first clean orphans) ──
    try {
      await client.query(`DELETE FROM shelf_movements_s WHERE task_id IS NOT NULL AND task_id NOT IN (SELECT id FROM inventory_tasks_s)`);
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_shelf_movements_task') THEN
            ALTER TABLE shelf_movements_s ADD CONSTRAINT fk_shelf_movements_task
              FOREIGN KEY (task_id) REFERENCES inventory_tasks_s(id) ON DELETE SET NULL;
          END IF;
        END $$
      `);
    } catch (e) { console.log('[DB] FK shelf_movements_s.task_id skip:', e.message); }

    // ─── Employee Breaks (lunch etc.) ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_breaks_s (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees_s(id) ON DELETE CASCADE,
        break_type VARCHAR(30) NOT NULL DEFAULT 'lunch',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_breaks_emp_date ON employee_breaks_s(employee_id, started_at DESC)`);

    // ─── Sklad-роли поверх users_d (общие логины с сайтом сотрудников) ──
    // users_d живёт в этой же БД bd2 (таблица сайта сотрудников). Сюда мы пишем
    // только своё: какой роли склада соответствует тот или иной users_d.id.
    // Источник правды по логину/паролю — users_d, мы её не модифицируем.
    await client.query(`
      CREATE TABLE IF NOT EXISTS sklad_user_roles_s (
        user_id        INTEGER PRIMARY KEY,
        role_id        INTEGER NOT NULL REFERENCES roles_s(id),
        granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        granted_by     INTEGER,
        last_active_at TIMESTAMPTZ
      )
    `);
    // FK на users_d НЕ ставим: при удалении users_d на стороне сайта сотрудников
    // запись sklad_user_roles_s остаётся как «сирота» — её можно вычистить
    // отдельным процессом, но удаление на сотрудниках при этом не блокируется.
    // На случай, если FK был создан в старых версиях — сносим.
    await client.query(`ALTER TABLE sklad_user_roles_s DROP CONSTRAINT IF EXISTS sklad_user_roles_s_user_id_fkey`);

    // Служебные аккаунты склада, не привязанные к сотруднику (например, главный admin).
    // Auth сначала ищет в users_d, потом — здесь.
    await client.query(`
      CREATE TABLE IF NOT EXISTS sklad_service_users_s (
        id             SERIAL PRIMARY KEY,
        username       VARCHAR(100) NOT NULL UNIQUE,
        password_hash  VARCHAR(255) NOT NULL,
        role_id        INTEGER NOT NULL REFERENCES roles_s(id),
        active         BOOLEAN NOT NULL DEFAULT true,
        last_active_at TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Seed default GRA rates per task type
    await client.query(`INSERT INTO settings_s (key, value) VALUES ('gra_rate_inventory', '10') ON CONFLICT (key) DO NOTHING`);
    await client.query(`INSERT INTO settings_s (key, value) VALUES ('gra_rate_packaging', '10') ON CONFLICT (key) DO NOTHING`);
    await client.query(`INSERT INTO settings_s (key, value) VALUES ('gra_rate_assembly', '10') ON CONFLICT (key) DO NOTHING`);
    await client.query(`INSERT INTO settings_s (key, value) VALUES ('gra_rate_production_transfer', '10') ON CONFLICT (key) DO NOTHING`);

    await client.query('COMMIT');
    console.log('[DB] Schema created/verified successfully');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('SELECT pg_advisory_unlock(42)').catch(() => {});
    client.release();
    if (err.message.includes('deadlock') && attempt < 3) {
      console.warn(`[DB] Deadlock on attempt ${attempt}, retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      return createSchema(attempt + 1);
    }
    console.error('[DB] Schema creation failed:', err.message);
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock(42)').catch(() => {});
    client.release();
  }
}

module.exports = { createSchema };
