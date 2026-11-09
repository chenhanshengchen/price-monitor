/**
 * 测试 GET /api/products/:id/batches
 *
 * 测试逻辑说明：
 *   1. 正常情况：有多个批次时，按 id DESC 返回，最新在前，字段完整
 *   2. 边界情况：商品存在但无批次，返回空数组
 *   3. 异常情况：传入不属于该商品的批次查询（归属隔离），另一商品的批次不会混入
 */

const assert = require('assert');
const { createTestDb, seedTestData } = require('./helpers/setup_test_db');

function getBatchesByProductId(db, productId) {
  if (!productId || productId < 1) return null;

  // 确认商品存在
  const product = db.exec('SELECT id FROM products WHERE id = ?', [productId]);
  if (product.length === 0 || product[0].values.length === 0) return null;

  const result = db.exec(`
    SELECT id, imported_at, collected_at, status, completeness,
           source_record_count, inserted_record_count, error_message
    FROM collection_batches
    WHERE product_id = ?
    ORDER BY id DESC
  `, [productId]);

  if (result.length === 0 || result[0].values.length === 0) return [];

  return result[0].values.map(([id, importedAt, collectedAt, status, completeness,
                                 sourceCount, insertedCount, errorMsg]) => ({
    id, importedAt, collectedAt, status, completeness,
    sourceRecordCount: sourceCount,
    insertedRecordCount: insertedCount,
    errorMessage: errorMsg
  }));
}

async function runTests() {
  console.log('=== 测试 GET /api/products/:id/batches ===\n');

  // 测试 1：正常情况 - 多个批次，按最新在前排序
  console.log('测试 1: 正常情况 - 有多个批次');
  const db1 = await createTestDb();
  const ids = seedTestData(db1);

  const batches = getBatchesByProductId(db1, ids.productId);
  assert.ok(Array.isArray(batches), '应返回数组');
  assert.strictEqual(batches.length, 2, '应有 2 个批次');
  assert.strictEqual(batches[0].id, ids.batch2, '第一个应是最新批次');
  assert.strictEqual(batches[1].id, ids.batch1, '第二个应是旧批次');
  assert.strictEqual(batches[0].status, 'success', 'status 应为 success');
  assert.strictEqual(batches[0].completeness, 'complete', 'completeness 应为 complete');
  assert.strictEqual(batches[0].sourceRecordCount, 3, '来源记录数应为 3');
  console.log('✅ 通过\n');
  db1.close();

  // 测试 2：边界情况 - 商品存在但无批次
  console.log('测试 2: 边界情况 - 商品存在但无批次');
  const db2 = await createTestDb();
  db2.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/2', '222', '无批次品牌', 5.0)`);

  const batches2 = getBatchesByProductId(db2, 1);
  assert.deepStrictEqual(batches2, [], '应返回空数组，不是 null');
  console.log('✅ 通过\n');
  db2.close();

  // 测试 3：异常情况 - 归属隔离（商品 A 的查询不返回商品 B 的批次）
  console.log('测试 3: 异常情况 - 归属隔离，不同商品批次互不混入');
  const db3 = await createTestDb();
  const idsA = seedTestData(db3); // 商品 A，ID=1，有 2 个批次

  // 添加商品 B
  db3.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/B', 'B001', '品牌B', 5.0)`);
  const productB = db3.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db3.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (?, '2026-10-27 06:00:00', 'success', 'complete', 5, 5)`, [productB]);

  // 查商品 A 只应得到商品 A 的 2 个批次
  const batchesA = getBatchesByProductId(db3, idsA.productId);
  assert.strictEqual(batchesA.length, 2, '商品 A 应只有 2 个批次');
  batchesA.forEach(b => {
    const check = db3.exec('SELECT product_id FROM collection_batches WHERE id = ?', [b.id]);
    assert.strictEqual(check[0].values[0][0], idsA.productId, `批次 ${b.id} 应属于商品 A`);
  });

  // 查商品 B 只应得到商品 B 的 1 个批次
  const batchesB = getBatchesByProductId(db3, productB);
  assert.strictEqual(batchesB.length, 1, '商品 B 应只有 1 个批次');

  // ID 不存在时应返回 null
  const batchesNull = getBatchesByProductId(db3, 9999);
  assert.strictEqual(batchesNull, null, '商品不存在时应返回 null');
  console.log('✅ 通过\n');
  db3.close();

  console.log('=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
