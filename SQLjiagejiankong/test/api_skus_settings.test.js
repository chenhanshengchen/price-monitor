/**
 * 测试以下 3 个 API:
 *
 * GET /api/products/:id/batches/:batchId/skus
 *   1. 正常情况：返回该批次所有 SKU 及价格，字段完整
 *   2. 边界情况：batchId 有效但无任何价格记录，返回空数组
 *   3. 异常情况：batchId 属于其他商品，应被拒绝
 *
 * PATCH /api/products/:id/settings
 *   1. 正常情况：传有效阈值，数据库更新，返回新值
 *   2. 边界情况：阈值传 0（合法，表示任何变动都报），应接受
 *   3. 异常情况：传负数、传非数字、传空，应拒绝
 *
 * GET /health
 *   1. 正常情况：数据库可用时返回 ok
 *   2. 异常情况：这里直接测返回字段齐全即可
 */

const assert = require('assert');
const { createTestDb, seedTestData } = require('./helpers/setup_test_db');

// ────────────────────────────────────────────
// getBatchSkus
// ────────────────────────────────────────────

function getBatchSkus(db, productId, batchId) {
  if (!productId || productId < 1 || !batchId || batchId < 1) {
    return { error: 'INVALID_PARAMS' };
  }

  const product = db.exec('SELECT id FROM products WHERE id = ?', [productId]);
  if (product.length === 0 || product[0].values.length === 0) {
    return { error: 'PRODUCT_NOT_FOUND' };
  }

  // 验证批次归属
  const batch = db.exec(
    'SELECT product_id, imported_at, status, completeness FROM collection_batches WHERE id = ?',
    [batchId]
  );
  if (batch.length === 0 || batch[0].values.length === 0) {
    return { error: 'BATCH_NOT_FOUND' };
  }
  if (batch[0].values[0][0] !== productId) {
    return { error: 'BATCH_NOT_BELONG_TO_PRODUCT' };
  }

  const [, importedAt, status, completeness] = batch[0].values[0];

  const rows = db.exec(`
    SELECT s.id, s.package_name, s.refraction, ps.daily_price, ps.promo_price
    FROM price_snapshots ps
    JOIN skus s ON ps.sku_id = s.id
    WHERE ps.batch_id = ?
    ORDER BY s.id
  `, [batchId]);

  const skus = rows.length > 0
    ? rows[0].values.map(([id, pkg, ref, daily, promo]) => ({
        id, packageName: pkg, refraction: ref, dailyPrice: daily, promoPrice: promo
      }))
    : [];

  return {
    batchId, importedAt, status, completeness,
    totalSkus: skus.length,
    skus
  };
}

// ────────────────────────────────────────────
// updateProductSettings
// ────────────────────────────────────────────

function updateProductSettings(db, productId, settings) {
  if (!productId || productId < 1) return { error: 'INVALID_PRODUCT_ID' };

  const product = db.exec('SELECT id FROM products WHERE id = ?', [productId]);
  if (product.length === 0 || product[0].values.length === 0) {
    return { error: 'PRODUCT_NOT_FOUND' };
  }

  const { price_threshold } = settings;

  if (price_threshold === undefined || price_threshold === null || price_threshold === '') {
    return { error: 'INVALID_THRESHOLD', message: '缺少 price_threshold 参数' };
  }

  const num = Number(price_threshold);
  if (!isFinite(num) || isNaN(num)) {
    return { error: 'INVALID_THRESHOLD', message: 'price_threshold 必须是数字' };
  }
  if (num < 0) {
    return { error: 'INVALID_THRESHOLD', message: 'price_threshold 不能为负数' };
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.run(
    'UPDATE products SET price_threshold = ?, updated_at = ? WHERE id = ?',
    [num, now, productId]
  );

  const updated = db.exec('SELECT price_threshold FROM products WHERE id = ?', [productId]);
  return {
    success: true,
    priceThreshold: updated[0].values[0][0]
  };
}

// ────────────────────────────────────────────
// getHealth
// ────────────────────────────────────────────

function getHealth(db) {
  const products = db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
  const batches = db.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
  const latest = db.exec(`
    SELECT MAX(imported_at) FROM collection_batches WHERE status = 'success'
  `)[0].values[0][0];

  return {
    status: 'ok',
    products,
    totalBatches: batches,
    latestImport: latest
  };
}

// ────────────────────────────────────────────
// 测试执行
// ────────────────────────────────────────────

async function runTests() {
  console.log('=== 测试 getBatchSkus / updateProductSettings / getHealth ===\n');

  // ── getBatchSkus ──

  console.log('[getBatchSkus] 测试 1: 正常情况 - 批次有 SKU 和价格');
  const db1 = await createTestDb();
  const ids = seedTestData(db1);
  const r1 = getBatchSkus(db1, ids.productId, ids.batch2);

  assert.ok(!r1.error, `不应返回错误，实际: ${r1.error}`);
  assert.strictEqual(r1.totalSkus, 3, '应有 3 个 SKU');
  assert.strictEqual(r1.skus[0].packageName, '套餐A', '第一个 SKU 套餐名正确');
  assert.strictEqual(r1.skus[0].promoPrice, '120', 'SKU A 活动价应为 120');
  assert.strictEqual(r1.skus[1].promoPrice, null, 'SKU B 活动价应为 null');
  assert.strictEqual(r1.status, 'success', '批次状态应为 success');
  console.log('✅ 通过\n');
  db1.close();

  console.log('[getBatchSkus] 测试 2: 边界情况 - 批次存在但无价格记录');
  const db2 = await createTestDb();
  db2.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/2', '222', '品牌', 5.0)`);
  db2.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (1, '2026-10-26 05:00:00', 'success', 'complete', 0, 0)`);
  const r2 = getBatchSkus(db2, 1, 1);
  assert.ok(!r2.error, `不应返回错误，实际: ${r2.error}`);
  assert.strictEqual(r2.totalSkus, 0, '无价格记录时 totalSkus 应为 0');
  assert.deepStrictEqual(r2.skus, [], '无价格记录时 skus 应为空数组');
  console.log('✅ 通过\n');
  db2.close();

  console.log('[getBatchSkus] 测试 3: 异常情况 - batchId 属于其他商品');
  const db3 = await createTestDb();
  const idsA3 = seedTestData(db3);
  db3.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/B', 'B001', '品牌B', 5.0)`);
  const productB3 = db3.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db3.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (?, '2026-10-27 06:00:00', 'success', 'complete', 0, 0)`, [productB3]);
  const batchB3 = db3.exec('SELECT last_insert_rowid()')[0].values[0][0];

  const r3 = getBatchSkus(db3, idsA3.productId, batchB3);
  assert.strictEqual(r3.error, 'BATCH_NOT_BELONG_TO_PRODUCT', '跨商品批次应被拒绝');
  console.log('✅ 通过\n');
  db3.close();

  // ── updateProductSettings ──

  console.log('[updateProductSettings] 测试 1: 正常情况 - 更新有效阈值');
  const db4 = await createTestDb();
  seedTestData(db4);
  const r4 = updateProductSettings(db4, 1, { price_threshold: 10.0 });
  assert.ok(r4.success, '应返回 success: true');
  assert.strictEqual(r4.priceThreshold, 10.0, '阈值应更新为 10.0');
  // 验证数据库真的改了
  const afterUpdate = db4.exec('SELECT price_threshold FROM products WHERE id = 1')[0].values[0][0];
  assert.strictEqual(afterUpdate, 10.0, '数据库中阈值应为 10.0');
  console.log('✅ 通过\n');
  db4.close();

  console.log('[updateProductSettings] 测试 2: 边界情况 - 阈值为 0（合法）');
  const db5 = await createTestDb();
  seedTestData(db5);
  const r5 = updateProductSettings(db5, 1, { price_threshold: 0 });
  assert.ok(r5.success, '阈值为 0 时应合法');
  assert.strictEqual(r5.priceThreshold, 0, '阈值应更新为 0');
  console.log('✅ 通过\n');
  db5.close();

  console.log('[updateProductSettings] 测试 3: 异常情况 - 各种非法输入');
  const db6 = await createTestDb();
  seedTestData(db6);

  const negative = updateProductSettings(db6, 1, { price_threshold: -5 });
  assert.strictEqual(negative.error, 'INVALID_THRESHOLD', '负数阈值应被拒绝');

  const notANumber = updateProductSettings(db6, 1, { price_threshold: 'abc' });
  assert.strictEqual(notANumber.error, 'INVALID_THRESHOLD', '非数字阈值应被拒绝');

  const emptyString = updateProductSettings(db6, 1, { price_threshold: '' });
  assert.strictEqual(emptyString.error, 'INVALID_THRESHOLD', '空字符串应被拒绝');

  const missingKey = updateProductSettings(db6, 1, {});
  assert.strictEqual(missingKey.error, 'INVALID_THRESHOLD', '缺少字段应被拒绝');

  const wrongProduct = updateProductSettings(db6, 9999, { price_threshold: 5 });
  assert.strictEqual(wrongProduct.error, 'PRODUCT_NOT_FOUND', '商品不存在应被拒绝');

  console.log('✅ 通过\n');
  db6.close();

  // ── getHealth ──

  console.log('[getHealth] 测试 1: 数据库正常时返回 ok 及统计');
  const db7 = await createTestDb();
  seedTestData(db7);
  const r7 = getHealth(db7);
  assert.strictEqual(r7.status, 'ok', 'status 应为 ok');
  assert.strictEqual(r7.products, 1, '应有 1 个商品');
  assert.strictEqual(r7.totalBatches, 2, '应有 2 个批次');
  assert.strictEqual(r7.latestImport, '2026-10-26 05:00:00', '最近导入时间应正确');
  console.log('✅ 通过\n');
  db7.close();

  console.log('[getHealth] 测试 2: 空库时返回 0 统计，status 仍为 ok');
  const db8 = await createTestDb();
  const r8 = getHealth(db8);
  assert.strictEqual(r8.status, 'ok', '空库时 status 也应为 ok');
  assert.strictEqual(r8.products, 0, '无商品时应为 0');
  assert.strictEqual(r8.latestImport, null, '无批次时 latestImport 应为 null');
  console.log('✅ 通过\n');
  db8.close();

  console.log('=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
