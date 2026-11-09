const PriceDatabase = require('../src/database');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '../data/test_step2.db');

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('=== 步骤 2 测试：findOrCreateProduct 方法 ===\n');

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
    // 测试 1：已有商品不重复注册
    console.log('测试 1：已有商品不重复注册');
    try {
      const db = new PriceDatabase();
      await db.init();

      const productId = db.findOrCreateProduct('563795984293', 'https://new_url', '蔡司新标题');

      if (productId !== 1) {
        throw new Error(`期望商品 ID 为 1，实际为 ${productId}`);
      }

      // 验证 page_title 已更新
      const result = db.db.exec('SELECT page_title, product_url FROM products WHERE id = 1');
      const [pageTitle, productUrl] = result[0].values[0];

      if (pageTitle !== '蔡司新标题') {
        throw new Error(`期望 page_title 为"蔡司新标题"，实际为"${pageTitle}"`);
      }

      if (productUrl !== 'https://new_url') {
        throw new Error(`期望 product_url 为"https://new_url"，实际为"${productUrl}"`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 2：新商品自动注册
    console.log('测试 2：新商品自动注册');
    try {
      const db = new PriceDatabase();
      await db.init();

      const productId = db.findOrCreateProduct('999999', 'https://test', '测试商品');

      if (productId !== 2) {
        throw new Error(`期望商品 ID 为 2，实际为 ${productId}`);
      }

      // 验证商品信息
      const result = db.db.exec('SELECT platform_product_id, brand, page_title, price_threshold FROM products WHERE id = 2');
      const [platformId, brand, pageTitle, threshold] = result[0].values[0];

      if (platformId !== '999999') {
        throw new Error(`期望 platform_product_id 为"999999"，实际为"${platformId}"`);
      }

      if (brand !== '未知品牌') {
        throw new Error(`期望 brand 为"未知品牌"，实际为"${brand}"`);
      }

      if (pageTitle !== '测试商品') {
        throw new Error(`期望 page_title 为"测试商品"，实际为"${pageTitle}"`);
      }

      if (threshold !== 5.0) {
        throw new Error(`期望 price_threshold 为 5.0，实际为 ${threshold}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 3：不覆盖 display_name 和 price_threshold
    console.log('测试 3：不覆盖 display_name 和 price_threshold');
    try {
      const db = new PriceDatabase();
      await db.init();

      // 手动设置 display_name 和 price_threshold
      db.db.run('UPDATE products SET display_name = ?, price_threshold = ? WHERE id = 1', ['用户简称', 10.0]);

      // 再次调用 findOrCreateProduct（注意：使用正确的商品 ID）
      db.findOrCreateProduct('563795984293', 'https://newer_url', '又一个新标题');

      // 验证 display_name 和 price_threshold 未被覆盖
      const result = db.db.exec('SELECT display_name, price_threshold, page_title FROM products WHERE id = 1');
      const [displayName, threshold, pageTitle] = result[0].values[0];

      if (displayName !== '用户简称') {
        throw new Error(`display_name 被覆盖了，期望"用户简称"，实际"${displayName}"`);
      }

      if (threshold !== 10.0) {
        throw new Error(`price_threshold 被覆盖了，期望 10.0，实际 ${threshold}`);
      }

      if (pageTitle !== '又一个新标题') {
        throw new Error(`page_title 未更新，期望"又一个新标题"，实际"${pageTitle}"`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 4：platformProductId 为空时抛出错误
    console.log('测试 4：platformProductId 为空时抛出错误');
    try {
      const db = new PriceDatabase();
      await db.init();

      try {
        db.findOrCreateProduct('', 'https://test', '测试');
        throw new Error('应该抛出错误但没有');
      } catch (error) {
        if (!error.message.includes('platform_product_id 不能为空')) {
          throw new Error(`错误消息不正确: ${error.message}`);
        }
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 5：超长标题被截断
    console.log('测试 5：超长标题被截断');
    try {
      const db = new PriceDatabase();
      await db.init();

      const longTitle = 'a'.repeat(1500);
      const productId = db.findOrCreateProduct('888888', 'https://unique_url_888888', longTitle);

      const result = db.db.exec('SELECT page_title FROM products WHERE id = ?', [productId]);
      const pageTitle = result[0].values[0][0];

      if (pageTitle.length !== 1000) {
        throw new Error(`期望标题长度为 1000，实际为 ${pageTitle.length}`);
      }

      db.close();
      console.log('✓ 通过\n');
      passed++;
    } catch (error) {
      console.log(`✗ 失败: ${error.message}\n`);
      failed++;
    }

    // 测试 6：title 和 url 为空或 null
    console.log('测试 6：title 和 url 为空或 null');
    try {
      const db = new PriceDatabase();
      await db.init();

      const productId = db.findOrCreateProduct('777777', null, null);

      const result = db.db.exec('SELECT product_url, page_title FROM products WHERE id = ?', [productId]);
      const [productUrl, pageTitle] = result[0].values[0];

      if (productUrl !== '') {
        throw new Error(`期望 product_url 为空字符串，实际为"${productUrl}"`);
      }

      if (pageTitle !== null) {
        throw new Error(`期望 page_title 为 NULL，实际为"${pageTitle}"`);
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
