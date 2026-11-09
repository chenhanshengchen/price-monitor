/**
 * 测试 GET /api/products 和 GET /api/products/:id
 *
 * 测试逻辑说明：
 *
 * getProducts:
 *   1. 正常情况 - 有商品时返回列表，包含 sku_count、涨降价统计
 *   2. 边界情况 - 商品有 SKU 但无任何批次，变动统计全为 0
 *   3. 异常情况 - 无商品时返回空数组，不报错
 *
 * getProductById:
 *   1. 正常情况 - 用正确 ID 查到商品，包含最新批次信息
 *   2. 边界情况 - 无批次的商品，latest_batch 为 null
 *   3. 异常情况 - ID 不存在时返回 null，调用方应转为 404
 */

const assert = require('assert');
const { createTestDb, seedTestData } = require('./helpers/setup_test_db');

function getProducts(db) {
  const products = db.exec('SELECT id, product_url, platform_product_id, brand, display_name, price_threshold FROM products');
  if (products.length === 0 || products[0].values.length === 0) return [];

  return products[0].values.map(([id, url, platformId, brand, displayName, threshold]) => {
    const skuCount = db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [id])[0].values[0][0];

    const latestBatch = db.exec(`
      SELECT id, imported_at, status, completeness, inserted_record_count
      FROM collection_batches WHERE product_id = ? AND status = 'success'
      ORDER BY id DESC LIMIT 1
    `, [id]);

    const latest = latestBatch.length > 0 && latestBatch[0].values.length > 0
      ? { id: latestBatch[0].values[0][0], importedAt: latestBatch[0].values[0][1],
          status: latestBatch[0].values[0][2], completeness: latestBatch[0].values[0][3],
          recordCount: latestBatch[0].values[0][4] }
      : null;

    const batchesResult = db.exec(`
      SELECT id FROM collection_batches WHERE product_id = ? AND status = 'success'
      ORDER BY id DESC LIMIT 2
    `, [id]);

    let increasedCount = 0;
    let decreasedCount = 0;

    if (batchesResult.length > 0 && batchesResult[0].values.length >= 2) {
      const [currentId, previousId] = batchesResult[0].values.map(r => r[0]);
      increasedCount = db.exec(`
        SELECT COUNT(*) FROM price_snapshots curr
        JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
        WHERE curr.batch_id = ? AND prev.batch_id = ?
          AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
          AND CAST(curr.promo_price AS REAL) - CAST(prev.promo_price AS REAL) > ?
      `, [currentId, previousId, threshold])[0].values[0][0];

      decreasedCount = db.exec(`
        SELECT COUNT(*) FROM price_snapshots curr
        JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
        WHERE curr.batch_id = ? AND prev.batch_id = ?
          AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
          AND CAST(prev.promo_price AS REAL) - CAST(curr.promo_price AS REAL) > ?
      `, [currentId, previousId, threshold])[0].values[0][0];
    }

    return { id, productUrl: url, platformProductId: platformId, brand, displayName,
             priceThreshold: threshold, skuCount, latestBatch: latest,
             priceChanges: { increasedCount, decreasedCount } };
  });
}

function getProductById(db, id) {
  if (!id || typeof id !== 'number' || id < 1) return null;

  const result = db.exec(
    'SELECT id, product_url, platform_product_id, brand, display_name, price_threshold FROM products WHERE id = ?',
    [id]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;

  const [pid, url, platformId, brand, displayName, threshold] = result[0].values[0];
  const skuCount = db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [pid])[0].values[0][0];

  const batchesResult = db.exec(`
    SELECT id, imported_at, status, completeness, inserted_record_count
    FROM collection_batches WHERE product_id = ? AND status = 'success'
    ORDER BY id DESC LIMIT 2
  `, [pid]);

  const batches = batchesResult.length > 0 ? batchesResult[0].values : [];
  const latestBatch = batches[0] ? { id: batches[0][0], importedAt: batches[0][1],
    status: batches[0][2], completeness: batches[0][3], recordCount: batches[0][4] } : null;
  const previousBatch = batches[1] ? { id: batches[1][0], importedAt: batches[1][1],
    status: batches[1][2], completeness: batches[1][3], recordCount: batches[1][4] } : null;

  return { id: pid, productUrl: url, platformProductId: platformId, brand, displayName,
           priceThreshold: threshold, skuCount, latestBatch, previousBatch };
}

async function runTests() {
  console.log('=== 测试 GET /api/products 和 GET /api/products/:id ===\n');

  // --- getProducts ---

  console.log('[getProducts] 测试 1: 正常情况 - 有商品和变动数据');
  const db1 = await createTestDb();
  const ids1 = seedTestData(db1);
  const list = getProducts(db1);

  assert.strictEqual(list.length, 1, '应返回 1 个商品');
  assert.strictEqual(list[0].brand, '蔡司', '品牌应为蔡司');
  assert.strictEqual(list[0].skuCount, 3, 'SKU 数应为 3');
  assert.ok(list[0].latestBatch !== null, '应有最新批次');
  assert.strictEqual(list[0].latestBatch.id, ids1.batch2, '最新批次 ID 应为 batch2');
  assert.strictEqual(list[0].priceChanges.increasedCount, 1, '涨价 SKU 数应为 1');
  assert.strictEqual(list[0].priceChanges.decreasedCount, 0, '降价 SKU 数应为 0');
  console.log('✅ 通过\n');
  db1.close();

  console.log('[getProducts] 测试 2: 边界情况 - 商品有 SKU 但无批次');
  const db2 = await createTestDb();
  db2.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/2', '222', '无批次品牌', 5.0)`);
  db2.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (1, '套餐A', '1.56')`);

  const list2 = getProducts(db2);
  assert.strictEqual(list2.length, 1, '应返回 1 个商品');
  assert.strictEqual(list2[0].skuCount, 1, 'SKU 数应为 1');
  assert.strictEqual(list2[0].latestBatch, null, '无批次时 latestBatch 应为 null');
  assert.strictEqual(list2[0].priceChanges.increasedCount, 0, '无批次时涨价数应为 0');
  console.log('✅ 通过\n');
  db2.close();

  console.log('[getProducts] 测试 3: 异常情况 - 无商品');
  const db3 = await createTestDb();
  const list3 = getProducts(db3);
  assert.deepStrictEqual(list3, [], '应返回空数组');
  console.log('✅ 通过\n');
  db3.close();

  // --- getProductById ---

  console.log('[getProductById] 测试 1: 正常情况 - ID 存在');
  const db4 = await createTestDb();
  const ids4 = seedTestData(db4);
  const product = getProductById(db4, ids4.productId);

  assert.ok(product !== null, '应返回商品');
  assert.strictEqual(product.brand, '蔡司', '品牌应为蔡司');
  assert.strictEqual(product.skuCount, 3, 'SKU 数应为 3');
  assert.strictEqual(product.latestBatch.id, ids4.batch2, '最新批次应为 batch2');
  assert.strictEqual(product.previousBatch.id, ids4.batch1, '上一批次应为 batch1');
  console.log('✅ 通过\n');
  db4.close();

  console.log('[getProductById] 测试 2: 边界情况 - 商品有 SKU 但无批次');
  const db5 = await createTestDb();
  db5.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/5', '555', '无批次品牌', 5.0)`);
  db5.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (1, '套餐A', '1.56')`);

  const product5 = getProductById(db5, 1);
  assert.ok(product5 !== null, '应返回商品');
  assert.strictEqual(product5.latestBatch, null, 'latestBatch 应为 null');
  assert.strictEqual(product5.previousBatch, null, 'previousBatch 应为 null');
  console.log('✅ 通过\n');
  db5.close();

  console.log('[getProductById] 测试 3: 异常情况 - ID 不存在');
  const db6 = await createTestDb();
  seedTestData(db6);
  const product6a = getProductById(db6, 9999);
  assert.strictEqual(product6a, null, 'ID 不存在应返回 null');

  const product6b = getProductById(db6, -1);
  assert.strictEqual(product6b, null, '负数 ID 应返回 null');

  const product6c = getProductById(db6, null);
  assert.strictEqual(product6c, null, 'null ID 应返回 null');
  console.log('✅ 通过\n');
  db6.close();

  console.log('=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
