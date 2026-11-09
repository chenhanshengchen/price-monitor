const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TEST_DB_PATH = path.join(__dirname, '../data/test_step4.db');
const TEST_JSON_DIR = path.join(__dirname, '../data/test_jsons');

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('=== 步骤 4 测试：多商品 JSON 导入 ===\n');

  // 准备测试环境
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  fs.copyFileSync(
    path.join(__dirname, '../data/price_monitor_new.db'),
    TEST_DB_PATH
  );

  if (!fs.existsSync(TEST_JSON_DIR)) {
    fs.mkdirSync(TEST_JSON_DIR, { recursive: true });
  }

  const originalDbPath = require('../config').paths.database;
  require('../config').paths.database = TEST_DB_PATH;

  try {
    // 测试 1：缺少 --file 参数
    console.log('测试 1：缺少 --file 参数');
    try {
      try {
        execSync('node index.js', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
        throw new Error('应该退出但没有');
      } catch (err) {
        if (!err.message.includes('缺少 --file 参数') && err.status !== 1) {
          throw new Error(`错误消息不正确: ${err.message}`);
        }
      }
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 2：文件不存在
    console.log('测试 2：文件不存在');
    try {
      try {
        execSync('node index.js --file /nonexistent.json', {
          cwd: path.join(__dirname, '..'),
          encoding: 'utf8',
          stdio: 'pipe'
        });
        throw new Error('应该退出但没有');
      } catch (err) {
        if (err.status !== 1) {
          throw new Error(`应该返回退出码 1，实际: ${err.status}`);
        }
      }
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 3：JSON 格式错误
    console.log('测试 3：JSON 格式错误');
    try {
      const invalidJson = path.join(TEST_JSON_DIR, 'invalid.json');
      fs.writeFileSync(invalidJson, '{invalid json}');

      try {
        execSync(`node index.js --file "${invalidJson}"`, {
          cwd: path.join(__dirname, '..'),
          encoding: 'utf8',
          stdio: 'pipe'
        });
        throw new Error('应该退出但没有');
      } catch (err) {
        if (err.status !== 1) {
          throw new Error(`应该返回退出码 1，实际: ${err.status}`);
        }
      }
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 4：新格式 JSON - 缺少 itemId
    console.log('测试 4：新格式 JSON - 缺少 itemId');
    try {
      const noItemId = path.join(TEST_JSON_DIR, 'no_itemid.json');
      fs.writeFileSync(noItemId, JSON.stringify({
        title: '测试商品',
        url: 'https://test',
        skus: [{ '镜片套餐': '套餐A', '折射率': '1.60', '日常价': '100', '活动价': '80' }]
      }));

      try {
        execSync(`node index.js --file "${noItemId}"`, {
          cwd: path.join(__dirname, '..'),
          encoding: 'utf8',
          stdio: 'pipe'
        });
        throw new Error('应该退出但没有');
      } catch (err) {
        if (err.status !== 1) {
          throw new Error(`应该返回退出码 1，实际: ${err.status}`);
        }
      }
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 5：新格式 JSON - 缺少 skus
    console.log('测试 5：新格式 JSON - 缺少 skus');
    try {
      const noSkus = path.join(TEST_JSON_DIR, 'no_skus.json');
      fs.writeFileSync(noSkus, JSON.stringify({
        itemId: '123456',
        title: '测试商品',
        url: 'https://test'
      }));

      try {
        execSync(`node index.js --file "${noSkus}"`, {
          cwd: path.join(__dirname, '..'),
          encoding: 'utf8',
          stdio: 'pipe'
        });
        throw new Error('应该退出但没有');
      } catch (err) {
        if (err.status !== 1) {
          throw new Error(`应该返回退出码 1，实际: ${err.status}`);
        }
      }
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 6：新格式 JSON - 正常导入（验证输出和数据库）
    console.log('测试 6：新格式 JSON - 正常导入');
    try {
      // 直接调用 runWithPayload 在测试数据库上验证
      const PriceDatabase = require('../src/database');
      const PriceMonitor = require('../src/priceMonitor');

      const monitor = new PriceMonitor();
      await monitor.runWithPayload({
        itemId: '999888',
        title: '测试新商品',
        url: 'https://test999888',
        skus: [
          { '镜片套餐': '套餐A', '折射率': '1.60', '日常价': '100', '活动价': '80' },
          { '镜片套餐': '套餐B', '折射率': '1.67', '日常价': '150', '活动价': '120' }
        ]
      });

      // 验证数据库
      const db = new PriceDatabase();
      await db.init();

      const product = db.db.exec('SELECT id, platform_product_id, page_title FROM products WHERE platform_product_id = ?', ['999888']);
      if (product.length === 0 || product[0].values.length === 0) {
        throw new Error('商品未写入数据库');
      }

      const [productId, platformId, pageTitle] = product[0].values[0];
      if (pageTitle !== '测试新商品') {
        throw new Error(`page_title 不正确: ${pageTitle}`);
      }

      const skus = db.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [productId]);
      if (skus[0].values[0][0] !== 2) {
        throw new Error(`SKU 数量不正确: 期望 2，实际 ${skus[0].values[0][0]}`);
      }

      const batches = db.db.exec('SELECT COUNT(*) FROM collection_batches WHERE product_id = ?', [productId]);
      if (batches[0].values[0][0] < 1) {
        throw new Error('批次未写入数据库');
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 7：旧格式 JSON - 兼容性
    console.log('测试 7：旧格式 JSON - 兼容性');
    try {
      const validOld = path.join(TEST_JSON_DIR, 'valid_old.json');
      fs.writeFileSync(validOld, JSON.stringify([
        { '镜片套餐': '旧格式套餐', '折射率': '1.60', '日常价': '200', '活动价': '180' }
      ]));

      const result = execSync(`node index.js --file "${validOld}" 2>&1`, {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8'
      });

      if (!result.includes('检测到旧格式 JSON') && !result.includes('旧格式')) {
        throw new Error('未检测到旧格式警告');
      }

      if (!result.includes('商品 ID: 563795984293')) {
        throw new Error('旧格式未归属到正确商品');
      }

      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

  } finally {
    // 恢复配置
    require('../config').paths.database = originalDbPath;

    // 清理测试文件
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_JSON_DIR)) {
      fs.rmSync(TEST_JSON_DIR, { recursive: true, force: true });
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
