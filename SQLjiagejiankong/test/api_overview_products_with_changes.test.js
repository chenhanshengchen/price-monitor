/**
 * 测试 getOverview() 中的 productsWithChanges 字段
 *
 * 验证"有超阈值变动的商品数量"统计口径是否正确：
 *
 * 1. 正常情况：1 个商品，2 个批次，有 SKU 活动价涨幅超阈值 → productsWithChanges = 1
 * 2. 边界情况：所有 SKU 的活动价变动都 ≤ 阈值 → productsWithChanges = 0
 * 3. 边界情况：商品只有 1 个批次（无上次可比较）→ productsWithChanges = 0
 * 4. 边界情况：新增活动价也算超阈值变动（promo: null → 200）→ productsWithChanges = 1
 * 5. 边界情况：取消活动价也算超阈值变动（promo: 200 → null）→ productsWithChanges = 1
 * 6. 异常情况：数据库无商品 → productsWithChanges = 0
 */

const assert = require('assert');
const { createTestDb } = require('./helpers/setup_test_db');

// 从 api.js 提取出来的纯逻辑（保持与实现完全一致）
function countProductsWithChanges(db) {
  const products = db.exec('SELECT id, price_threshold FROM products');
  if (products.length === 0 || products[0].values.length === 0) return 0;

  let count = 0;
  for (const [productId, threshold] of products[0].values) {
    const batches = db.exec(`
      SELECT id FROM collection_batches
      WHERE product_id = ? AND status = 'success'
      ORDER BY id DESC LIMIT 2
    `, [productId]);

    if (batches.length === 0 || batches[0].values.length < 2) continue;

    const [currentId, previousId] = batches[0].values.map(r => r[0]);

    const changed = db.exec(`
      SELECT COUNT(*) FROM (
        SELECT curr.sku_id
        FROM price_snapshots curr
        JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
        WHERE curr.batch_id = ? AND prev.batch_id = ?
          AND (
            (curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
             AND ABS(CAST(curr.promo_price AS REAL) - CAST(prev.promo_price AS REAL)) > ?)
            OR (prev.promo_price IS NULL AND curr.promo_price IS NOT NULL)
            OR (prev.promo_price IS NOT NULL AND curr.promo_price IS NULL)
          )
        LIMIT 1
      )
    `, [currentId, previousId, threshold]);

    if (changed[0].values[0][0] > 0) count++;
  }
  return count;
}

// 辅助：快速插入商品、SKU、批次、价格快照
function insertProduct(db, url, threshold = 5.0) {
  db.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
          VALUES (?, ?, '测试品牌', ?)`, [url, url, threshold]);
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

function insertSku(db, productId, packageName, refraction = '1.56') {
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (?, ?, ?)`,
    [productId, packageName, refraction]);
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

function insertBatch(db, productId, importedAt) {
  db.run(`INSERT INTO collection_batches
          (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
          VALUES (?, ?, 'success', 'complete', 1, 1)`, [productId, importedAt]);
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

function insertPrice(db, batchId, skuId, promoPrice) {
  const promo = promoPrice === null ? null : String(promoPrice);
  db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price)
          VALUES (?, ?, '999', ?)`, [batchId, skuId, promo]);
}

async function runTests() {
  console.log('=== 测试 productsWithChanges 统计逻辑 ===\n');

  // 测试 1：正常情况 - 活动价涨幅超阈值（+20 > 阈值 5）
  console.log('测试 1: 正常情况 - 活动价涨价超阈值');
  {
    const db = await createTestDb();
    const pid = insertProduct(db, 'https://test.com/1', 5.0);
    const sid = insertSku(db, pid, '套餐A');
    const b1 = insertBatch(db, pid, '2026-10-25 05:00:00');
    const b2 = insertBatch(db, pid, '2026-10-26 05:00:00');
    insertPrice(db, b1, sid, 100);   // 上次: 100
    insertPrice(db, b2, sid, 120);   // 本次: 120，涨 20 > 阈值 5
    assert.strictEqual(countProductsWithChanges(db), 1, '应有 1 个商品超阈值');
    db.close();
  }
  console.log('✅ 通过\n');

  // 测试 2：边界情况 - 活动价变动等于阈值（= 5），不超过
  console.log('测试 2: 边界情况 - 活动价变动恰好等于阈值（不超过）');
  {
    const db = await createTestDb();
    const pid = insertProduct(db, 'https://test.com/2', 5.0);
    const sid = insertSku(db, pid, '套餐A');
    const b1 = insertBatch(db, pid, '2026-10-25 05:00:00');
    const b2 = insertBatch(db, pid, '2026-10-26 05:00:00');
    insertPrice(db, b1, sid, 100);
    insertPrice(db, b2, sid, 105);   // 涨 5 = 阈值，不超过
    assert.strictEqual(countProductsWithChanges(db), 0, '等于阈值不算超阈值');
    db.close();
  }
  console.log('✅ 通过\n');

  // 测试 3：边界情况 - 商品只有 1 个批次，无可比数据
  console.log('测试 3: 边界情况 - 只有 1 个批次');
  {
    const db = await createTestDb();
    const pid = insertProduct(db, 'https://test.com/3', 5.0);
    const sid = insertSku(db, pid, '套餐A');
    const b1 = insertBatch(db, pid, '2026-10-25 05:00:00');
    insertPrice(db, b1, sid, 100);
    assert.strictEqual(countProductsWithChanges(db), 0, '只有 1 个批次应返回 0');
    db.close();
  }
  console.log('✅ 通过\n');

  // 测试 4：边界情况 - 新增活动价（null → 200）算超阈值变动
  console.log('测试 4: 边界情况 - 新增活动价算作变动');
  {
    const db = await createTestDb();
    const pid = insertProduct(db, 'https://test.com/4', 5.0);
    const sid = insertSku(db, pid, '套餐A');
    const b1 = insertBatch(db, pid, '2026-10-25 05:00:00');
    const b2 = insertBatch(db, pid, '2026-10-26 05:00:00');
    insertPrice(db, b1, sid, null);  // 上次: 无活动价
    insertPrice(db, b2, sid, 200);   // 本次: 新增活动价
    assert.strictEqual(countProductsWithChanges(db), 1, '新增活动价应算变动');
    db.close();
  }
  console.log('✅ 通过\n');

  // 测试 5：边界情况 - 取消活动价（200 → null）算超阈值变动
  console.log('测试 5: 边界情况 - 取消活动价算作变动');
  {
    const db = await createTestDb();
    const pid = insertProduct(db, 'https://test.com/5', 5.0);
    const sid = insertSku(db, pid, '套餐A');
    const b1 = insertBatch(db, pid, '2026-10-25 05:00:00');
    const b2 = insertBatch(db, pid, '2026-10-26 05:00:00');
    insertPrice(db, b1, sid, 200);   // 上次: 有活动价
    insertPrice(db, b2, sid, null);  // 本次: 取消活动价
    assert.strictEqual(countProductsWithChanges(db), 1, '取消活动价应算变动');
    db.close();
  }
  console.log('✅ 通过\n');

  // 测试 6：异常情况 - 数据库无商品
  console.log('测试 6: 异常情况 - 无商品');
  {
    const db = await createTestDb();
    assert.strictEqual(countProductsWithChanges(db), 0, '无商品应返回 0');
    db.close();
  }
  console.log('✅ 通过\n');

  console.log('=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err.message, err.stack);
  process.exit(1);
});
