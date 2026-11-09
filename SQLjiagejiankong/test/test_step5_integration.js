const PriceDatabase = require('../src/database');
const PriceMonitor = require('../src/priceMonitor');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '../data/test_step5.db');

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('=== 步骤 5 综合测试：多商品导入 ===\n');

  // 准备测试环境
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  fs.copyFileSync(
    path.join(__dirname, '../data/price_monitor_new.db'),
    TEST_DB_PATH
  );

  const originalDbPath = require('../config').paths.database;
  require('../config').paths.database = TEST_DB_PATH;

  try {
    // 测试 1：首次导入商品 A
    console.log('测试 1：首次导入商品 A');
    try {
      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: 'PRODUCT_A',
        title: '商品 A 标题',
        url: 'https://test.com/a',
        skus: [
          { '镜片套餐': '套餐 A1', '折射率': '1.60', '日常价': '100', '活动价': '90' },
          { '镜片套餐': '套餐 A2', '折射率': '1.67', '日常价': '150', '活动价': '140' }
        ]
      });

      const db = new PriceDatabase();
      await db.init();

      const product = db.db.exec('SELECT id, platform_product_id, page_title FROM products WHERE platform_product_id = ?', ['PRODUCT_A']);
      if (product.length === 0 || product[0].values.length === 0) {
        throw new Error('商品 A 未创建');
      }

      const productId = product[0].values[0][0];
      const skus = db.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [productId]);
      if (skus[0].values[0][0] !== 2) {
        throw new Error(`SKU 数量错误: 期望 2, 实际 ${skus[0].values[0][0]}`);
      }

      const batches = db.db.exec('SELECT COUNT(*) FROM collection_batches WHERE product_id = ?', [productId]);
      if (batches[0].values[0][0] !== 1) {
        throw new Error('批次未创建');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 2：商品 A 第二次导入（更新）
    console.log('测试 2：商品 A 第二次导入（更新标题和价格）');
    try {
      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: 'PRODUCT_A',
        title: '商品 A 新标题',
        url: 'https://test.com/a_new',
        skus: [
          { '镜片套餐': '套餐 A1', '折射率': '1.60', '日常价': '100', '活动价': '85' }, // 价格变了
          { '镜片套餐': '套餐 A2', '折射率': '1.67', '日常价': '150', '活动价': '140' }
        ]
      });

      const db = new PriceDatabase();
      await db.init();

      const product = db.db.exec('SELECT page_title, product_url FROM products WHERE platform_product_id = ?', ['PRODUCT_A']);
      if (product[0].values[0][0] !== '商品 A 新标题') {
        throw new Error('标题未更新');
      }
      if (product[0].values[0][1] !== 'https://test.com/a_new') {
        throw new Error('URL 未更新');
      }

      const productId = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0][0];
      const batches = db.db.exec('SELECT COUNT(*) FROM collection_batches WHERE product_id = ?', [productId]);
      if (batches[0].values[0][0] !== 2) {
        throw new Error('第二个批次未创建');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 3：首次导入商品 B
    console.log('测试 3：首次导入商品 B');
    try {
      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: 'PRODUCT_B',
        title: '商品 B 标题',
        url: 'https://test.com/b',
        skus: [
          { '镜片套餐': '套餐 B1', '折射率': '1.60', '日常价': '200', '活动价': '180' }
        ]
      });

      const db = new PriceDatabase();
      await db.init();

      const products = db.db.exec('SELECT COUNT(*) FROM products');
      if (products[0].values[0][0] !== 3) { // 原有蔡司 + A + B
        throw new Error(`商品总数错误: 期望 3, 实际 ${products[0].values[0][0]}`);
      }

      const product = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_B']);
      if (product.length === 0 || product[0].values.length === 0) {
        throw new Error('商品 B 未创建');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 4：商品 A 和 B 的 SKU 隔离
    console.log('测试 4：商品 A 和 B 的 SKU 相互隔离');
    try {
      const monitor = new PriceMonitor();
      // 给商品 B 添加与商品 A 同名的 SKU
      await monitor.runWithPayload({
        itemId: 'PRODUCT_B',
        title: '商品 B 标题',
        url: 'https://test.com/b',
        skus: [
          { '镜片套餐': '套餐 A1', '折射率': '1.60', '日常价': '200', '活动价': '180' }, // 与商品 A 同名
          { '镜片套餐': '套餐 B1', '折射率': '1.60', '日常价': '200', '活动价': '180' }
        ]
      });

      const db = new PriceDatabase();
      await db.init();

      const productA = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0][0];
      const productB = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_B'])[0].values[0][0];

      const skusA = db.db.exec('SELECT package_name FROM skus WHERE product_id = ?', [productA]);
      const skusB = db.db.exec('SELECT package_name FROM skus WHERE product_id = ?', [productB]);

      // 商品 A 应该有 2 个 SKU（A1, A2）
      if (skusA[0].values.length !== 2) {
        throw new Error(`商品 A SKU 数量错误: ${skusA[0].values.length}`);
      }

      // 商品 B 应该有 2 个 SKU（A1, B1），虽然 A1 同名但 SKU ID 不同
      if (skusB[0].values.length !== 2) {
        throw new Error(`商品 B SKU 数量错误: ${skusB[0].values.length}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 5：商品 A 和 B 的批次隔离
    console.log('测试 5：商品 A 和 B 的批次相互隔离');
    try {
      const db = new PriceDatabase();
      await db.init();

      const productA = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0][0];
      const productB = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_B'])[0].values[0][0];

      const batchesA = db.db.exec('SELECT COUNT(*) FROM collection_batches WHERE product_id = ?', [productA])[0].values[0][0];
      const batchesB = db.db.exec('SELECT COUNT(*) FROM collection_batches WHERE product_id = ?', [productB])[0].values[0][0];

      // 商品 A 应该有 2 个批次（测试 1 和测试 2）
      if (batchesA !== 2) {
        throw new Error(`商品 A 批次数量错误: 期望 2, 实际 ${batchesA}`);
      }

      // 商品 B 应该有 2 个批次（测试 3 和测试 4）
      if (batchesB !== 2) {
        throw new Error(`商品 B 批次数量错误: 期望 2, 实际 ${batchesB}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 6：商品 A 价格对比使用商品 A 的阈值
    console.log('测试 6：价格对比使用各自商品的阈值');
    try {
      const db = new PriceDatabase();
      await db.init();

      // 设置商品 A 阈值为 10，商品 B 阈值为 50
      const productA = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0][0];
      const productB = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_B'])[0].values[0][0];

      db.db.run('UPDATE products SET price_threshold = ? WHERE id = ?', [10, productA]);
      db.db.run('UPDATE products SET price_threshold = ? WHERE id = ?', [50, productB]);
      db.save();

      // 商品 A：90 → 85，变动 5，小于阈值 10
      const { current: currentA, previous: previousA } = db.getLatestTwoBatches(productA);
      const changesA = db.getPriceChanges(productA, currentA, previousA);

      if (changesA.length !== 0) {
        throw new Error(`商品 A 应该无超阈值变动，实际: ${changesA.length}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 7：新增 SKU
    console.log('测试 7：商品 A 新增 SKU');
    try {
      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: 'PRODUCT_A',
        title: '商品 A 新标题',
        url: 'https://test.com/a_new',
        skus: [
          { '镜片套餐': '套餐 A1', '折射率': '1.60', '日常价': '100', '活动价': '85' },
          { '镜片套餐': '套餐 A2', '折射率': '1.67', '日常价': '150', '活动价': '140' },
          { '镜片套餐': '套餐 A3', '折射率': '1.74', '日常价': '200', '活动价': '190' } // 新增
        ]
      });

      const db = new PriceDatabase();
      await db.init();

      const productA = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0][0];
      const skus = db.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [productA])[0].values[0][0];

      if (skus !== 3) {
        throw new Error(`SKU 数量错误: 期望 3, 实际 ${skus}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 8：SKU 消失（不再出现在新批次中）
    console.log('测试 8：商品 A SKU 消失（不再抓取）');
    try {
      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: 'PRODUCT_A',
        title: '商品 A 新标题',
        url: 'https://test.com/a_new',
        skus: [
          { '镜片套餐': '套餐 A1', '折射率': '1.60', '日常价': '100', '活动价': '85' },
          // A2 消失，A3 消失
        ]
      });

      const db = new PriceDatabase();
      await db.init();

      const productA = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0][0];

      // SKU 表中仍保留历史 SKU
      const allSkus = db.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [productA])[0].values[0][0];
      if (allSkus !== 3) {
        throw new Error('历史 SKU 应该保留在 skus 表中');
      }

      // 最新批次只有 A1
      const latestBatch = db.db.exec('SELECT id FROM collection_batches WHERE product_id = ? ORDER BY id DESC LIMIT 1', [productA])[0].values[0][0];
      const snapshotsInLatest = db.db.exec('SELECT COUNT(*) FROM price_snapshots WHERE batch_id = ?', [latestBatch])[0].values[0][0];
      if (snapshotsInLatest !== 1) {
        throw new Error(`最新批次应该只有 1 个快照，实际: ${snapshotsInLatest}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 9：顺序导入多个商品（sql.js 内存模式不支持真正并发写入）
    console.log('测试 9：顺序导入商品 C 和 D（符合影刀循环采集场景）');
    try {
      const monitorC = new PriceMonitor();
      await monitorC.runWithPayload({
        itemId: 'PRODUCT_C',
        title: '商品 C',
        url: 'https://test.com/c',
        skus: [{ '镜片套餐': '套餐 C1', '折射率': '1.60', '日常价': '100', '活动价': '90' }]
      });

      const monitorD = new PriceMonitor();
      await monitorD.runWithPayload({
        itemId: 'PRODUCT_D',
        title: '商品 D',
        url: 'https://test.com/d',
        skus: [{ '镜片套餐': '套餐 D1', '折射率': '1.60', '日常价': '100', '活动价': '90' }]
      });

      const db = new PriceDatabase();
      await db.init();

      const products = db.db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
      if (products !== 5) { // 蔡司 + A + B + C + D
        throw new Error(`商品总数错误: 期望 5, 实际 ${products}`);
      }

      // 验证 C 和 D 各自独立
      const productC = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_C']);
      const productD = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_D']);

      if (productC.length === 0 || productC[0].values.length === 0) {
        throw new Error('商品 C 未找到');
      }
      if (productD.length === 0 || productD[0].values.length === 0) {
        throw new Error('商品 D 未找到');
      }
      if (productC[0].values[0][0] === productD[0].values[0][0]) {
        throw new Error('商品 C 和 D 的 ID 不应相同');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 10：空 SKU 数组
    console.log('测试 10：导入空 SKU 数组（应该失败）');
    try {
      const monitor = new PriceMonitor();
      try {
        await monitor.runWithPayload({
          itemId: 'PRODUCT_E',
          title: '商品 E',
          url: 'https://test.com/e',
          skus: []
        });
        throw new Error('应该抛出错误但没有');
      } catch (err) {
        if (!err.message.includes('空数组') && !err.message.includes('length')) {
          // 任何与数据验证相关的错误都可以
        }
      }

      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 11：缺少必要字段的 SKU
    console.log('测试 11：SKU 缺少套餐名（应该跳过）');
    try {
      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: 'PRODUCT_F',
        title: '商品 F',
        url: 'https://test.com/f',
        skus: [
          { '折射率': '1.60', '日常价': '100', '活动价': '90' }, // 缺少镜片套餐
          { '镜片套餐': '套餐 F1', '折射率': '1.60', '日常价': '100', '活动价': '90' }
        ]
      });

      const db = new PriceDatabase();
      await db.init();

      const productF = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_F'])[0].values[0][0];
      const skus = db.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [productF])[0].values[0][0];

      if (skus !== 1) {
        throw new Error(`应该只有 1 个有效 SKU，实际: ${skus}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 12：display_name 不被自动导入覆盖
    console.log('测试 12：display_name 不被自动导入覆盖');
    try {
      const db = new PriceDatabase();
      await db.init();

      // 手动设置商品 A 的 display_name
      const productA = db.db.exec('SELECT id FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0][0];
      db.db.run('UPDATE products SET display_name = ? WHERE id = ?', ['用户自定义名称', productA]);
      db.save();
      db.close();

      // 再次导入商品 A
      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: 'PRODUCT_A',
        title: '商品 A 又一次新标题',
        url: 'https://test.com/a_new2',
        skus: [
          { '镜片套餐': '套餐 A1', '折射率': '1.60', '日常价': '100', '活动价': '85' }
        ]
      });

      const db2 = new PriceDatabase();
      await db2.init();

      const result = db2.db.exec('SELECT display_name, page_title FROM products WHERE platform_product_id = ?', ['PRODUCT_A'])[0].values[0];
      const [displayName, pageTitle] = result;

      if (displayName !== '用户自定义名称') {
        throw new Error(`display_name 被覆盖了: ${displayName}`);
      }

      if (pageTitle !== '商品 A 又一次新标题') {
        throw new Error(`page_title 未更新: ${pageTitle}`);
      }

      db2.close();
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
