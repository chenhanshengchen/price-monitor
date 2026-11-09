/**
 * 测试 GET /api/products/:id/comparison
 *
 * 这是最核心的业务逻辑测试，覆盖价格比较的所有情况：
 *
 * 测试逻辑说明：
 *   1. 正常情况：两批次间有涨价、降价、无变化、取消活动价，各自归类正确
 *   2. 边界情况：只有 1 个批次（无上次批次），返回明确的 NO_PREVIOUS_BATCH 状态
 *   3. 边界情况：两个批次都没有活动价，返回 0 可比较 SKU
 *   4. 边界情况：恰好等于阈值不算超阈值，超过才算
 *   5. 异常情况：跨商品调用（B 的 batch 传给 A），应被拒绝
 */

const assert = require('assert');
const { createTestDb, seedTestData } = require('./helpers/setup_test_db');

function getComparison(db, productId, currentBatchId, previousBatchId) {
  // 参数校验
  if (!productId || productId < 1) return { error: 'INVALID_PRODUCT_ID' };

  const product = db.exec(
    'SELECT id, price_threshold FROM products WHERE id = ?', [productId]
  );
  if (product.length === 0 || product[0].values.length === 0) {
    return { error: 'PRODUCT_NOT_FOUND' };
  }
  const threshold = product[0].values[0][1];

  // 解析 currentBatchId
  let currentId = currentBatchId;
  if (!currentId) {
    const latest = db.exec(`
      SELECT id FROM collection_batches
      WHERE product_id = ? AND status = 'success'
      ORDER BY id DESC LIMIT 1
    `, [productId]);
    if (latest.length === 0 || latest[0].values.length === 0) {
      return { error: 'NO_BATCH', message: '该商品暂无批次数据' };
    }
    currentId = latest[0].values[0][0];
  }

  // 验证批次归属
  const batchCheck = db.exec(
    'SELECT product_id FROM collection_batches WHERE id = ?', [currentId]
  );
  if (batchCheck.length === 0 || batchCheck[0].values.length === 0) {
    return { error: 'BATCH_NOT_FOUND' };
  }
  if (batchCheck[0].values[0][0] !== productId) {
    return { error: 'BATCH_NOT_BELONG_TO_PRODUCT' };
  }

  // 解析 previousBatchId
  let previousId = previousBatchId;
  if (!previousId) {
    const prev = db.exec(`
      SELECT id FROM collection_batches
      WHERE product_id = ? AND status = 'success' AND id < ?
      ORDER BY id DESC LIMIT 1
    `, [productId, currentId]);
    if (prev.length === 0 || prev[0].values.length === 0) {
      return { error: 'NO_PREVIOUS_BATCH', message: '暂无可比数据' };
    }
    previousId = prev[0].values[0][0];
  }

  // 同样验证上一批次归属
  const prevBatchCheck = db.exec(
    'SELECT product_id FROM collection_batches WHERE id = ?', [previousId]
  );
  if (prevBatchCheck.length === 0 || prevBatchCheck[0].values.length === 0) {
    return { error: 'PREVIOUS_BATCH_NOT_FOUND' };
  }
  if (prevBatchCheck[0].values[0][0] !== productId) {
    return { error: 'BATCH_NOT_BELONG_TO_PRODUCT' };
  }

  // 查询所有 SKU 的两批次价格
  const rows = db.exec(`
    SELECT
      s.id     AS sku_id,
      s.package_name,
      s.refraction,
      curr.promo_price AS current_promo,
      prev.promo_price AS previous_promo
    FROM skus s
    LEFT JOIN price_snapshots curr ON curr.sku_id = s.id AND curr.batch_id = ?
    LEFT JOIN price_snapshots prev ON prev.sku_id = s.id AND prev.batch_id = ?
    WHERE s.product_id = ?
    ORDER BY s.id
  `, [currentId, previousId, productId]);

  const skus = rows.length > 0 ? rows[0].values : [];
  const result = {
    currentBatchId: currentId,
    previousBatchId: previousId,
    priceThreshold: threshold,
    summary: { increased: 0, decreased: 0, newPromo: 0, canceledPromo: 0,
               unchanged: 0, noPromo: 0, missingInCurrent: 0 },
    changes: []
  };

  for (const [skuId, packageName, refraction, currentPromo, previousPromo] of skus) {
    let changeType;
    let changeAmount = null;

    if (currentPromo === null && previousPromo === null) {
      changeType = 'no_promo';
      result.summary.noPromo++;
    } else if (previousPromo !== null && currentPromo === null) {
      changeType = 'promo_canceled';
      result.summary.canceledPromo++;
    } else if (previousPromo === null && currentPromo !== null) {
      changeType = 'new_promo';
      result.summary.newPromo++;
    } else {
      // 两次都有活动价，比较金额
      const curr = parseFloat(currentPromo);
      const prev = parseFloat(previousPromo);
      changeAmount = (curr - prev).toFixed(2);

      if (curr - prev > threshold) {
        changeType = 'increased';
        result.summary.increased++;
      } else if (prev - curr > threshold) {
        changeType = 'decreased';
        result.summary.decreased++;
      } else {
        changeType = 'unchanged';
        result.summary.unchanged++;
      }
    }

    // 只在 changes 里放有变动的 SKU
    if (['increased', 'decreased', 'new_promo', 'promo_canceled'].includes(changeType)) {
      result.changes.push({
        skuId, packageName, refraction,
        currentPromo, previousPromo, changeAmount, changeType
      });
    }
  }

  return result;
}

async function runTests() {
  console.log('=== 测试 GET /api/products/:id/comparison ===\n');

  // 测试 1：正常情况 - 涨价、取消活动价、无变化、无活动价各一个
  console.log('测试 1: 正常情况 - 含涨价/取消/无变化/无活动价');
  const db1 = await createTestDb();
  const ids = seedTestData(db1);
  // 测试夹具：SKU A 涨价 100→120，SKU B 无活动价，SKU C 活动价取消 200→NULL

  const r1 = getComparison(db1, ids.productId, ids.batch2, ids.batch1);
  assert.ok(!r1.error, `不应返回错误, 实际: ${r1.error}`);
  assert.strictEqual(r1.summary.increased, 1, '涨价 SKU 应为 1 (SKU A +20 > 阈值 5)');
  assert.strictEqual(r1.summary.decreased, 0, '降价 SKU 应为 0');
  assert.strictEqual(r1.summary.canceledPromo, 1, '取消活动价应为 1 (SKU C)');
  assert.strictEqual(r1.summary.newPromo, 0, '新增活动价应为 0');
  assert.strictEqual(r1.summary.noPromo, 1, '无活动价应为 1 (SKU B)');
  assert.strictEqual(r1.changes.length, 2, '变动列表应有 2 条 (涨价+取消)');
  assert.strictEqual(r1.priceThreshold, 5.0, '阈值应为 5.0');
  console.log('✅ 通过\n');
  db1.close();

  // 测试 2：边界情况 - 只有 1 个批次，无上次批次
  console.log('测试 2: 边界情况 - 只有 1 个批次');
  const db2 = await createTestDb();
  db2.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/2', '222', '测试品牌', 5.0)`);
  db2.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (1, '2026-10-26 05:00:00', 'success', 'complete', 0, 0)`);

  const r2 = getComparison(db2, 1, null, null);
  assert.strictEqual(r2.error, 'NO_PREVIOUS_BATCH', '应返回 NO_PREVIOUS_BATCH 错误');
  assert.ok(r2.message, '应包含错误信息文本');
  console.log('✅ 通过\n');
  db2.close();

  // 测试 3：边界情况 - 两批次均无活动价
  console.log('测试 3: 边界情况 - 两批次所有 SKU 均无活动价');
  const db3 = await createTestDb();
  db3.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/3', '333', '测试品牌', 5.0)`);
  db3.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (1, '套餐A', '1.56')`);
  db3.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (1, '2026-10-25 05:00:00', 'success', 'complete', 1, 1)`);
  db3.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (1, 1, '300', NULL)`);
  db3.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (1, '2026-10-26 05:00:00', 'success', 'complete', 1, 1)`);
  db3.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (2, 1, '300', NULL)`);

  const r3 = getComparison(db3, 1, 2, 1);
  assert.ok(!r3.error, '不应返回错误');
  assert.strictEqual(r3.summary.noPromo, 1, '无活动价 SKU 应为 1');
  assert.strictEqual(r3.changes.length, 0, '变动列表应为空');
  assert.strictEqual(r3.summary.increased, 0, '涨价 SKU 应为 0');
  console.log('✅ 通过\n');
  db3.close();

  // 测试 4：边界情况 - 阈值边界（等于阈值不算超阈值）
  console.log('测试 4: 边界情况 - 价格变动恰好等于阈值（不超阈值）');
  const db4 = await createTestDb();
  db4.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/4', '444', '测试品牌', 5.0)`);
  db4.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (1, '套餐A', '1.56')`);
  db4.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (1, '2026-10-25 05:00:00', 'success', 'complete', 1, 1)`);
  db4.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (1, 1, '300', '100')`);
  db4.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (1, '2026-10-26 05:00:00', 'success', 'complete', 1, 1)`);
  // 涨价 5 元，恰好等于阈值
  db4.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (2, 1, '300', '105')`);

  const r4equal = getComparison(db4, 1, 2, 1);
  assert.strictEqual(r4equal.summary.increased, 0, '等于阈值时不应算涨价');
  assert.strictEqual(r4equal.summary.unchanged, 1, '等于阈值应算不变');

  // 涨价 5.01 元，超过阈值
  db4.run(`UPDATE price_snapshots SET promo_price = '105.01' WHERE batch_id = 2 AND sku_id = 1`);
  const r4over = getComparison(db4, 1, 2, 1);
  assert.strictEqual(r4over.summary.increased, 1, '超过阈值时应算涨价');
  console.log('✅ 通过\n');
  db4.close();

  // 测试 5：异常情况 - 批次归属不属于该商品
  console.log('测试 5: 异常情况 - 跨商品传入批次 ID 应被拒绝');
  const db5 = await createTestDb();
  const idsA = seedTestData(db5); // 商品 A，有 batch1, batch2

  // 插入商品 B 和它自己的批次
  db5.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
           VALUES ('https://test.com/B', 'B001', '品牌B', 5.0)`);
  const productB = db5.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db5.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
           VALUES (?, '2026-10-27 06:00:00', 'success', 'complete', 0, 0)`, [productB]);
  const batchB = db5.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // 用商品 A 的 ID，但传入商品 B 的批次
  const r5 = getComparison(db5, idsA.productId, batchB, null);
  assert.strictEqual(r5.error, 'BATCH_NOT_BELONG_TO_PRODUCT', '跨商品批次应返回归属错误');
  console.log('✅ 通过\n');
  db5.close();

  console.log('=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
