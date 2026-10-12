const pool = require('../db/pool');

/**
 * Log a movement/action to movements_s
 * @param {object} opts
 * @param {string} opts.movement_type - e.g. 'edit_add_to_pallet', 'edit_add_to_shelf', 'task_scan', etc.
 * @param {number} opts.product_id
 * @param {number} opts.quantity
 * @param {number} [opts.from_pallet_id]
 * @param {number} [opts.from_shelf_id]
 * @param {number} [opts.from_box_id]
 * @param {number} [opts.from_employee_id]
 * @param {number} [opts.to_pallet_id]
 * @param {number} [opts.to_shelf_id]
 * @param {number} [opts.to_box_id]
 * @param {number} [opts.to_employee_id]
 * @param {number} opts.performed_by - user id
 * @param {string} [opts.notes]
 * @param {string} [opts.source] - 'scan', 'manual', 'task', 'packing', 'fbo', 'edit'
 * @param {object} [opts.client] - pg client for transactions
 */
async function logMovement(opts) {
  const db = opts.client || pool;
  try {
    await db.query(
      `INSERT INTO movements_s (movement_type, product_id, quantity,
        from_pallet_id, from_shelf_id, from_box_id, from_employee_id,
        to_pallet_id, to_shelf_id, to_box_id, to_employee_id,
        performed_by, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        opts.movement_type,
        opts.product_id || null,
        opts.quantity || 0,
        opts.from_pallet_id || null,
        opts.from_shelf_id || null,
        opts.from_box_id || null,
        opts.from_employee_id || null,
        opts.to_pallet_id || null,
        opts.to_shelf_id || null,
        opts.to_box_id || null,
        opts.to_employee_id || null,
        opts.performed_by || null,
        opts.notes || null,
        opts.source || 'manual',
      ]
    );
  } catch (err) {
    console.error('[LogMovement] Error:', err.message);
  }
}

module.exports = { logMovement };
