const pool = require('../db/pool');
const externalPool = require('../db/externalPool');

/**
 * Sync employees from external (employees_d) into local employees_s mirror.
 *
 * Rules:
 * - Only sync employees with external_employee_id link
 * - Never touch local-only users (no external link)
 * - Reactivate employees that reappear on external site
 *
 * Пароли/логины больше НЕ мирроятся: аутентификация читает users_d напрямую
 * (см. routes/auth.js). Теневая users_s создаётся при первом логине.
 */
async function syncEmployeesFromOsite() {
  try {
    const { rows: extEmployees } = await externalPool.query(`
      SELECT e.id, e.full_name, e.phone, e.status, e.department_id,
             p.name AS position_name, d.name AS department_name,
             u.login, u.password_plain
      FROM employees_d e
      LEFT JOIN positions_d p ON p.id = e.position_id
      LEFT JOIN departments_d d ON d.id = e.department_id
      LEFT JOIN users_d u ON u.employee_id = e.id
      WHERE e.status IN ('active', 'internship', 'pending_employment')
      ORDER BY e.full_name
    `);

    let created = 0, updated = 0, deactivated = 0;

    for (const ext of extEmployees) {
      const existing = await pool.query(
        'SELECT id FROM employees_s WHERE external_employee_id = $1',
        [ext.id]
      );

      let empId;
      if (existing.rows.length > 0) {
        empId = existing.rows[0].id;
        // Update name/phone/position, reactivate
        await pool.query(
          `UPDATE employees_s SET full_name=$1, phone=$2, position=$3, department=$4, active=true WHERE id=$5`,
          [ext.full_name, ext.phone, ext.position_name, ext.department_name || null, empId]
        );
        await pool.query('UPDATE users_s SET active = true WHERE employee_id = $1', [empId]);
        updated++;
      } else {
        const res = await pool.query(
          `INSERT INTO employees_s (full_name, position, phone, external_employee_id, active, department)
           VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
          [ext.full_name, ext.position_name, ext.phone, ext.id, ext.department_name || null]
        );
        empId = res.rows[0].id;
        created++;
      }

      // NOTE: пароли/логины больше не мирроятся.
      // Аутентификация склада читает users_d напрямую (см. routes/auth.js).
      // Теневая users_s создаётся при первом успешном логине.
    }

    // Deactivate linked employees no longer active on external site
    const activeExtIds = new Set(extEmployees.map(e => Number(e.id)));
    const localLinked = await pool.query(
      'SELECT id, external_employee_id FROM employees_s WHERE external_employee_id IS NOT NULL AND active = true'
    );
    for (const local of localLinked.rows) {
      if (!activeExtIds.has(Number(local.external_employee_id))) {
        await pool.query('UPDATE employees_s SET active = false WHERE id = $1', [local.id]);
        await pool.query('UPDATE users_s SET active = false WHERE employee_id = $1', [local.id]);
        deactivated++;
      }
    }

    // NOTE: Never touch local-only users (no external_employee_id)

    // Hard sync: deactivate ALL user accounts whose employee is inactive
    const { rowCount: fixedUsers } = await pool.query(`
      UPDATE users_s u SET active = false
      FROM employees_s e
      WHERE u.employee_id = e.id
        AND e.active = false
        AND u.active = true
    `);
    if (fixedUsers > 0) console.log(`[Sync] Fixed ${fixedUsers} stale user accounts`);

    // Авто-роль склада: каждому новому users_d (у кого активный сотрудник)
    // выдаём по умолчанию роль "Сотрудник" (role_id = 3) на складе.
    // users_d НЕ модифицируется — пишем только в нашу sklad_user_roles_s.
    // Идемпотентно: ON CONFLICT DO NOTHING.
    const { rowCount: autoGranted } = await pool.query(`
      INSERT INTO sklad_user_roles_s (user_id, role_id)
      SELECT u.id, 3
      FROM users_d u
      JOIN employees_d e ON e.id = u.employee_id
      WHERE e.status IN ('active','internship','pending_employment')
        AND NOT EXISTS (SELECT 1 FROM sklad_user_roles_s sur WHERE sur.user_id = u.id)
      ON CONFLICT (user_id) DO NOTHING
    `);
    if (autoGranted > 0) console.log(`[Sync] Auto-granted Сотрудник role to ${autoGranted} new users_d`);

    console.log(`[Sync] Created ${created}, updated ${updated}, deactivated ${deactivated}`);
  } catch (err) {
    console.error('[Sync] Error:', err.message);
  }
}

module.exports = { syncEmployeesFromOsite };
