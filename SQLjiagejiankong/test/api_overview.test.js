/**
 * 测试 GET /api/overview
 *
 * 测试逻辑说明：
 * 1. 正常情况：有商品、有批次、有价格变动时，返回完整统计
 * 2. 边界情况：只有 1 个批次（无上次批次可比较）时，返回 0 变动
 * 3. 异常情况：数据库为空（无商品）时，返回全 0 统计
 */

const assert = require('assert');
const { createTestDb, seedTestData } = require('./helpers/setup_test_db');

// 模拟 API 核心逻辑
function getOverview(db) {
  // 统计商品数
  const productCountResult = db.exec('SELECT COUNT(*) FROM products');
  const productCount = productCountResult[0].values[0][0];

  if (productCount === 0) {
    return {
      monitoredProductCount: 0,
      latestRecordTime: null,
      collectionStatus: 'unknown',
      priceChangeSummary: {
        increasedCount: 0,
        decreasedCount: 0,
        newPromoCount: 0,
        canceledPromoCount: 0
      }
    };
  }

  // 获取最新批次时间
  const latestBatchResult = db.exec(`
    SELECT MAX(imported_at) FROM collection_batches WHERE status = 'success'
  `);
  const latestRecordTime = latestBatchResult[0].values[0][0];

  // 获取最近 2 个成功批次
  const batchesResult = db.exec(`
    SELECT id FROM collection_batches
    WHERE status = 'success'
    ORDER BY id DESC LIMIT 2
  `);

  let changeSummary = {
    increasedCount: 0,
    decreasedCount: 0,
    newPromoCount: 0,
    canceledPromoCount: 0
  };

  if (batchesResult.length > 0 && batchesResult[0].values.length >= 2) {
    const [currentBatchId, previousBatchId] = batchesResult[0].values.map(row => row[0]);

    // 阈值统一用 5.0（简化测试）
    const threshold = 5.0;

    // 涨价：curr > prev + threshold
    const increasedResult = db.exec(`
      SELECT COUNT(*) FROM price_snapshots curr
      JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
      WHERE curr.batch_id = ? AND prev.batch_id = ?
        AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
        AND CAST(curr.promo_price AS REAL) - CAST(prev.promo_price AS REAL) > ?
    `, [currentBatchId, previousBatchId, threshold]);
    changeSummary.increasedCount = increasedResult[0].values[0][0];

    // 降价：prev > curr + threshold
    const decreasedResult = db.exec(`
      SELECT COUNT(*) FROM price_snapshots curr
      JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
      WHERE curr.batch_id = ? AND prev.batch_id = ?
        AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
        AND CAST(prev.promo_price AS REAL) - CAST(curr.promo_price AS REAL) > ?
    `, [currentBatchId, previousBatchId, threshold]);
    changeSummary.decreasedCount = decreasedResult[0].values[0][0];

    // 新增活动价：prev = NULL, curr != NULL
    const newPromoResult = db.exec(`
      SELECT COUNT(*) FROM price_snapshots curr
      JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
      WHERE curr.batch_id = ? AND prev.batch_id = ?
        AND prev.promo_price IS NULL AND curr.promo_price IS NOT NULL
    `, [currentBatchId, previousBatchId]);
    changeSummary.newPromoCount = newPromoResult[0].values[0][0];

    // 取消活动价：prev != NULL, curr = NULL
    const canceledPromoResult = db.exec(`
      SELECT COUNT(*) FROM price_snapshots curr
      JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
      WHERE curr.batch_id = ? AND prev.batch_id = ?
        AND prev.promo_price IS NOT NULL AND curr.promo_price IS NULL
    `, [currentBatchId, previousBatchId]);
    changeSummary.canceledPromoCount = canceledPromoResult[0].values[0][0];
  }

  return {
    monitoredProductCount: productCount,
    latestRecordTime,
    collectionStatus: 'unknown',
    priceChangeSummary: changeSummary
  };
}

async function runTests() {
  console.log('=== 测试 GET /api/overview ===\n');

  // 测试 1：正常情况 - 有完整数据
  console.log('测试 1: 正常情况 - 有商品、批次、价格变动');
  const db1 = await createTestDb();
  seedTestData(db1);
  const result1 = getOverview(db1);

  assert.strictEqual(result1.monitoredProductCount, 1, '商品数应为 1');
  assert.strictEqual(result1.latestRecordTime, '2026-10-26 05:00:00', '最新记录时间应为批次 2');
  assert.strictEqual(result1.priceChangeSummary.increasedCount, 1, '涨价 SKU 数应为 1 (SKU A)');
  assert.strictEqual(result1.priceChangeSummary.decreasedCount, 0, '降价 SKU 数应为 0');
  assert.strictEqual(result1.priceChangeSummary.newPromoCount, 0, '新增活动价应为 0');
  assert.strictEqual(result1.priceChangeSummary.canceledPromoCount, 1, '取消活动价应为 1 (SKU C)');
  console.log('✅ 通过\n');
  db1.close();

  // 测试 2：边界情况 - 只有 1 个批次
  console.log('测试 2: 边界情况 - 只有 1 个批次（无上次批次）');
  const db2 = await createTestDb();
  db2.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.tmall.com/item?id=222', '222', '测试品牌', 5.0)`);
  db2.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (1, '2026-10-26 05:00:00', 'success', 'complete', 0, 0)`);

  const result2 = getOverview(db2);
  assert.strictEqual(result2.monitoredProductCount, 1, '商品数应为 1');
  assert.strictEqual(result2.priceChangeSummary.increasedCount, 0, '涨价 SKU 数应为 0');
  assert.strictEqual(result2.priceChangeSummary.decreasedCount, 0, '降价 SKU 数应为 0');
  assert.strictEqual(result2.priceChangeSummary.newPromoCount, 0, '新增活动价应为 0');
  assert.strictEqual(result2.priceChangeSummary.canceledPromoCount, 0, '取消活动价应为 0');
  console.log('✅ 通过\n');
  db2.close();

  // 测试 3：异常情况 - 数据库为空
  console.log('测试 3: 异常情况 - 数据库为空（无商品）');
  const db3 = await createTestDb();
  const result3 = getOverview(db3);

  assert.strictEqual(result3.monitoredProductCount, 0, '商品数应为 0');
  assert.strictEqual(result3.latestRecordTime, null, '最新记录时间应为 null');
  assert.strictEqual(result3.priceChangeSummary.increasedCount, 0, '涨价 SKU 数应为 0');
  assert.strictEqual(result3.priceChangeSummary.decreasedCount, 0, '降价 SKU 数应为 0');
  console.log('✅ 通过\n');
  db3.close();

  console.log('=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
