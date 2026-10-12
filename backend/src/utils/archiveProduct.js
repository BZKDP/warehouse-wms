async function archiveProductRecord(client, {
  productId,
  archivedBy = null,
  source = 'manual',
  reason = null,
}) {
  const found = await client.query(
    'SELECT * FROM products_s WHERE id = $1 FOR UPDATE',
    [productId]
  );
  if (!found.rows.length) return null;

  const before = found.rows[0];
  const archive = await client.query(
    `INSERT INTO archived_products_s
       (original_product_id, external_id, name, code, article, entity_type,
        product_snapshot, archive_source, archive_reason, archived_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     ON CONFLICT (original_product_id) DO UPDATE SET
       external_id = EXCLUDED.external_id,
       name = EXCLUDED.name,
       code = EXCLUDED.code,
       article = EXCLUDED.article,
       entity_type = EXCLUDED.entity_type,
       product_snapshot = EXCLUDED.product_snapshot,
       archive_source = EXCLUDED.archive_source,
       archive_reason = EXCLUDED.archive_reason,
       archived_by = EXCLUDED.archived_by,
       archived_at = NOW()
     RETURNING id, archived_at`,
    [
      before.id,
      before.external_id || null,
      before.name,
      before.code || null,
      before.article || null,
      before.entity_type,
      JSON.stringify(before),
      String(source || 'manual').slice(0, 50),
      reason ? String(reason).slice(0, 2000) : null,
      archivedBy || null,
    ]
  );

  const updated = await client.query(
    `UPDATE products_s
        SET archived = true, manually_archived = true, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [before.id]
  );

  return {
    product: updated.rows[0],
    archive: archive.rows[0],
    alreadyArchived: Boolean(before.archived),
  };
}

module.exports = { archiveProductRecord };
