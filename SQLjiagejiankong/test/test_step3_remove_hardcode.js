const PriceDatabase = require('../src/database');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '../data/test_step3.db');

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('=== 步骤 3 测试：移除 productId 硬编码 ===\n');

  // 清理旧测试数据库
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // 创建测试数据库
  fs.copyFileSync(
    path.join(__dirname, '../data/price_monitor_new.db'),
    TEST_DB_PATH
  );

  const originalDbPath = require('../config').paths.database;
  require('../config').paths.database = TEST_DB_PATH;

  try {
    // 测试 1：init() 不再检查特定商品
    console.log('测试 1：init() 不再检查特定商品');
    try {
      const db = new PriceDatabase();
      await db.init();

      if (db.productId !== undefined) {
        throw new Error('db.productId 应该是 undefined');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 2：createBatch 需要 productId 参数
    console.log('测试 2：createBatch 需要 productId 参数');
    try {
      const db = new PriceDatabase();
      await db.init();

      try {
        db.createBatch(null, 10); // productId 为 null
        throw new Error('应该抛出错误但没有');
      } catch (error) {
        if (!error.message.includes('productId 参数必需')) {
          throw new Error(`错误消息不正确: ${error.message}`);
        }
      }

      // 正常调用
      const batchId = db.createBatch(1, 10);
      if (!batchId || batchId < 1) {
        throw new Error(`批次 ID 无效: ${batchId}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 3：findOrCreateSKU 需要 productId 参数
    console.log('测试 3：findOrCreateSKU 需要 productId 参数');
    try {
      const db = new PriceDatabase();
      await db.init();

      try {
        db.findOrCreateSKU('测试套餐', '1.60'); // 缺少 productId
        throw new Error('应该抛出错误但没有');
      } catch (error) {
        if (!error.message.includes('productId 参数必需')) {
          throw new Error(`错误消息不正确: ${error.message}`);
        }
      }

      // 正常调用
      const skuId = db.findOrCreateSKU(1, '测试套餐', '1.60');
      if (!skuId || skuId < 1) {
        throw new Error(`SKU ID 无效: ${skuId}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 4：getLatestTwoBatches 需要 productId 参数
    console.log('测试 4：getLatestTwoBatches 需要 productId 参数');
    try {
      const db = new PriceDatabase();
      await db.init();

      try {
        db.getLatestTwoBatches(); // 缺少 productId
        throw new Error('应该抛出错误但没有');
      } catch (error) {
        if (!error.message.includes('productId 参数必需')) {
          throw new Error(`错误消息不正确: ${error.message}`);
        }
      }

      // 正常调用
      const batches = db.getLatestTwoBatches(1);
      if (!batches || typeof batches !== 'object') {
        throw new Error('返回值格式错误');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 5：getPriceChanges 需要 productId 参数并使用商品阈值
    console.log('测试 5：getPriceChanges 需要 productId 参数并使用商品阈值');
    try {
      const db = new PriceDatabase();
      await db.init();

      try {
        db.getPriceChanges(null, 1, 2); // productId 为 null
        throw new Error('应该抛出错误但没有');
      } catch (error) {
        if (!error.message.includes('productId 参数必需')) {
          throw new Error(`错误消息不正确: ${error.message}`);
        }
      }

      // 正常调用（previousBatchId 为 null 时返回空数组）
      const changes = db.getPriceChanges(1, 1, null);
      if (!Array.isArray(changes)) {
        throw new Error('返回值应该是数组');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 6：不同商品的 SKU 隔离
    console.log('测试 6：不同商品的 SKU 隔离');
    try {
      const db = new PriceDatabase();
      await db.init();

      // 创建两个商品
      const productId1 = db.findOrCreateProduct('111111', 'https://test1', '商品1');
      const productId2 = db.findOrCreateProduct('222222', 'https://test2', '商品2');

      // 两个商品创建相同的 SKU（套餐名+折射率）
      const sku1 = db.findOrCreateSKU(productId1, '测试套餐', '1.60');
      const sku2 = db.findOrCreateSKU(productId2, '测试套餐', '1.60');

      // SKU ID 应该不同（说明按 product_id 隔离了）
      if (sku1 === sku2) {
        throw new Error('相同套餐名的 SKU 没有按商品隔离');
      }

      // 验证 SKU 归属
      const skus1 = db.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ? AND package_name = ?', [productId1, '测试套餐']);
      const skus2 = db.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ? AND package_name = ?', [productId2, '测试套餐']);

      if (skus1[0].values[0][0] !== 1 || skus2[0].values[0][0] !== 1) {
        throw new Error('SKU 归属验证失败');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

  } finally {
    // 恢复配置
    require('../config').paths.database = originalDbPath;

    // 清理测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  }

  console.log('===================');
  console.log(`总计: ${passed + failed} 个测试`);
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
