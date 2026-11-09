/**
 * 测试 PATCH /api/products/:id/settings 的扩展功能
 * 同时支持更新 platformProductId 和 price_threshold
 *
 * 测试逻辑说明：
 *
 * 更新商品 ID (platformProductId)：
 *   1. 正常情况：传有效字符串，数据库更新，返回新值
 *   2. 边界情况：传空字符串（清空商品 ID），应接受
 *   3. 异常情况：传非字符串（数字、对象），应拒绝
 *
 * 更新价格阈值 (price_threshold)：
 *   1. 正常情况：传有效阈值 10，数据库更新，返回新值
 *   2. 边界情况：传 0（合法），应接受
 *   3. 异常情况：传负数、非数字，应拒绝
 *
 * 同时更新两个字段：
 *   1. 正常情况：同时传 platformProductId 和 price_threshold，两个字段都更新
 *   2. 边界情况：只传其中一个，另一个保持不变
 *   3. 异常情况：price_threshold 非法时，整个请求被拒绝，商品 ID 也不更新
 */

const assert = require('assert');
const { createTestDb, seedTestData } = require('./helpers/setup_test_db');

// 复制 updateSettings 的核心逻辑（与 src/api.js 保持一致）
function updateSettings(db, productId, settings) {
  if (productId === null || productId < 1) return { error: 'INVALID_PRODUCT_ID' };

  const product = db.exec('SELECT id FROM products WHERE id = ?', [productId]);
  if (product.length === 0 || product[0].values.length === 0) {
    return { error: 'PRODUCT_NOT_FOUND' };
  }

  const { price_threshold, platform_product_id } = settings;

  // 如果传了 price_threshold，必须校验
  let thresholdUpdate = false;
  let newThreshold = null;
  if (price_threshold !== undefined) {
    if (price_threshold === null || price_threshold === '') {
      return { error: 'INVALID_THRESHOLD', message: 'price_threshold 不能为空' };
    }
    const num = Number(price_threshold);
    if (!isFinite(num) || isNaN(num)) {
      return { error: 'INVALID_THRESHOLD', message: 'price_threshold 必须是数字' };
    }
    if (num < 0) {
      return { error: 'INVALID_THRESHOLD', message: 'price_threshold 不能为负数' };
    }
    thresholdUpdate = true;
    newThreshold = num;
  }

  // 如果传了 platform_product_id，必须校验
  let idUpdate = false;
  let newPlatformId = null;
  if (platform_product_id !== undefined) {
    if (typeof platform_product_id !== 'string') {
      return { error: 'INVALID_PLATFORM_ID', message: 'platform_product_id 必须是字符串' };
    }
    // 允许空字符串（清空），但不允许过长
    if (platform_product_id.length > 100) {
      return { error: 'INVALID_PLATFORM_ID', message: 'platform_product_id 不能超过 100 字符' };
    }
    idUpdate = true;
    newPlatformId = platform_product_id;
  }

  // 至少传一个字段
  if (!thresholdUpdate && !idUpdate) {
    return { error: 'NO_FIELDS', message: '至少需要更新一个字段' };
  }

  // 构造 SQL
  const sets = [];
  const params = [];
  if (thresholdUpdate) {
    sets.push('price_threshold = ?');
    params.push(newThreshold);
  }
  if (idUpdate) {
    sets.push('platform_product_id = ?');
    params.push(newPlatformId);
  }
  sets.push('updated_at = ?');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  params.push(now);
  params.push(productId);

  db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);

  // 返回更新后的数据
  const updated = db.exec(
    'SELECT platform_product_id, price_threshold FROM products WHERE id = ?',
    [productId]
  );
  const [updatedPlatformId, updatedThreshold] = updated[0].values[0];

  return {
    success: true,
    platformProductId: updatedPlatformId,
    priceThreshold: updatedThreshold
  };
}

async function runTests() {
  console.log('=== 测试 updateSettings 扩展功能 ===\n');

  // ── 更新商品 ID (platformProductId) ──

  console.log('[商品 ID] 测试 1: 正常情况 - 更新为有效字符串');
  const db1 = await createTestDb();
  seedTestData(db1);
  const r1 = updateSettings(db1, 1, { platform_product_id: 'NEW123456' });
  assert.ok(r1.success, '应返回 success: true');
  assert.strictEqual(r1.platformProductId, 'NEW123456', '商品 ID 应更新为 NEW123456');
  // 验证数据库真的改了
  const dbCheck1 = db1.exec('SELECT platform_product_id FROM products WHERE id = 1')[0].values[0][0];
  assert.strictEqual(dbCheck1, 'NEW123456', '数据库中商品 ID 应为 NEW123456');
  console.log('✅ 通过\n');
  db1.close();

  console.log('[商品 ID] 测试 2: 边界情况 - 传空字符串（清空）');
  const db2 = await createTestDb();
  seedTestData(db2);
  const r2 = updateSettings(db2, 1, { platform_product_id: '' });
  assert.ok(r2.success, '空字符串应被接受');
  assert.strictEqual(r2.platformProductId, '', '商品 ID 应为空字符串');
  console.log('✅ 通过\n');
  db2.close();

  console.log('[商品 ID] 测试 3: 异常情况 - 传非字符串');
  const db3 = await createTestDb();
  seedTestData(db3);
  const r3a = updateSettings(db3, 1, { platform_product_id: 123 });
  assert.strictEqual(r3a.error, 'INVALID_PLATFORM_ID', '数字应被拒绝');
  const r3b = updateSettings(db3, 1, { platform_product_id: { a: 1 } });
  assert.strictEqual(r3b.error, 'INVALID_PLATFORM_ID', '对象应被拒绝');
  const r3c = updateSettings(db3, 1, { platform_product_id: null });
  assert.strictEqual(r3c.error, 'INVALID_PLATFORM_ID', 'null 应被拒绝');
  console.log('✅ 通过\n');
  db3.close();

  // ── 更新价格阈值 (price_threshold) ──

  console.log('[价格阈值] 测试 1: 正常情况 - 更新为 10');
  const db4 = await createTestDb();
  seedTestData(db4);
  const r4 = updateSettings(db4, 1, { price_threshold: 10.0 });
  assert.ok(r4.success, '应返回 success: true');
  assert.strictEqual(r4.priceThreshold, 10.0, '阈值应更新为 10.0');
  console.log('✅ 通过\n');
  db4.close();

  console.log('[价格阈值] 测试 2: 边界情况 - 传 0');
  const db5 = await createTestDb();
  seedTestData(db5);
  const r5 = updateSettings(db5, 1, { price_threshold: 0 });
  assert.ok(r5.success, '阈值为 0 应被接受');
  assert.strictEqual(r5.priceThreshold, 0, '阈值应为 0');
  console.log('✅ 通过\n');
  db5.close();

  console.log('[价格阈值] 测试 3: 异常情况 - 负数和非数字');
  const db6 = await createTestDb();
  seedTestData(db6);
  const r6a = updateSettings(db6, 1, { price_threshold: -5 });
  assert.strictEqual(r6a.error, 'INVALID_THRESHOLD', '负数应被拒绝');
  const r6b = updateSettings(db6, 1, { price_threshold: 'abc' });
  assert.strictEqual(r6b.error, 'INVALID_THRESHOLD', '非数字应被拒绝');
  console.log('✅ 通过\n');
  db6.close();

  // ── 同时更新两个字段 ──

  console.log('[同时更新] 测试 1: 正常情况 - 同时更新两个字段');
  const db7 = await createTestDb();
  seedTestData(db7);
  const r7 = updateSettings(db7, 1, { platform_product_id: 'COMBO789', price_threshold: 15 });
  assert.ok(r7.success, '应返回 success: true');
  assert.strictEqual(r7.platformProductId, 'COMBO789', '商品 ID 应更新');
  assert.strictEqual(r7.priceThreshold, 15, '阈值应更新');
  console.log('✅ 通过\n');
  db7.close();

  console.log('[同时更新] 测试 2: 边界情况 - 只更新一个，另一个不变');
  const db8 = await createTestDb();
  seedTestData(db8);
  // 只更新商品 ID，阈值应保持原值 5.0
  const r8 = updateSettings(db8, 1, { platform_product_id: 'ONLY_ID' });
  assert.ok(r8.success, '应成功');
  assert.strictEqual(r8.platformProductId, 'ONLY_ID', '商品 ID 应更新');
  assert.strictEqual(r8.priceThreshold, 5.0, '阈值应保持原值 5.0');
  console.log('✅ 通过\n');
  db8.close();

  console.log('[同时更新] 测试 3: 异常情况 - 阈值非法时，商品 ID 也不更新');
  const db9 = await createTestDb();
  seedTestData(db9);
  const r9 = updateSettings(db9, 1, { platform_product_id: 'SHOULD_NOT_SAVE', price_threshold: -1 });
  assert.strictEqual(r9.error, 'INVALID_THRESHOLD', '应因阈值非法被拒绝');
  // 验证数据库里商品 ID 没变（应为原值 111）
  const dbCheck9 = db9.exec('SELECT platform_product_id FROM products WHERE id = 1')[0].values[0][0];
  assert.strictEqual(dbCheck9, '111', '商品 ID 不应被更新');
  console.log('✅ 通过\n');
  db9.close();

  console.log('=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
