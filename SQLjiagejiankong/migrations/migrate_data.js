const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/price_monitor.db');
const BACKUP_PATH = path.resolve(__dirname, `../data/price_monitor_backup_${Date.now()}.db`);

async function migrate() {
  console.log('=== 开始数据库迁移 ===\n');

  console.log('步骤 1: 备份原数据库...');
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log(`✓ 备份完成: ${BACKUP_PATH}\n`);

  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  console.log('步骤 2: 加载迁移脚本...');
  const migrationSQL = fs.readFileSync(
    path.resolve(__dirname, '001_optimize_schema.sql'),
    'utf8'
  );

  console.log('步骤 3: 执行表结构创建...');
  const statements = migrationSQL.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    if (stmt.trim()) {
      try {
        db.run(stmt);
      } catch (e) {
        if (!e.message.includes('already exists')) {
          console.warn('警告:', e.message);
        }
      }
    }
  }
  console.log('✓ 表结构创建完成\n');

  console.log('步骤 4: 迁移商品数据到 products 表...');
  const existingProducts = db.exec(`
    SELECT DISTINCT package_name, refraction
    FROM price_history
    ORDER BY package_name, refraction
  `);

  if (existingProducts.length > 0) {
    const products = existingProducts[0].values;
    const insertProduct = db.prepare(
      'INSERT OR IGNORE INTO products (package_name, refraction) VALUES (?, ?)'
    );

    products.forEach(([packageName, refraction]) => {
      insertProduct.run([packageName, refraction]);
    });
    insertProduct.free();
    console.log(`✓ 已迁移 ${products.length} 个商品\n`);
  }

  console.log('步骤 5: 迁移价格历史数据...');
  const priceHistory = db.exec(`
    SELECT package_name, refraction, daily_price, promo_price, record_time
    FROM price_history
    ORDER BY record_time
  `);

  if (priceHistory.length > 0) {
    const records = priceHistory[0].values;
    let migratedCount = 0;
    let errorCount = 0;

    const getProductId = db.prepare(
      'SELECT id FROM products WHERE package_name = ? AND refraction = ?'
    );
    const insertPrice = db.prepare(`
      INSERT OR IGNORE INTO price_history_v2
      (product_id, daily_price, promo_price, record_time)
      VALUES (?, ?, ?, ?)
    `);

    records.forEach(([packageName, refraction, dailyPrice, promoPrice, recordTime]) => {
      getProductId.bind([packageName, refraction]);

      if (getProductId.step()) {
        const productId = getProductId.getAsObject().id;

        const parsedDailyPrice = parseFloat(dailyPrice) || 0;
        const parsedPromoPrice = promoPrice && promoPrice !== '' ? parseFloat(promoPrice) : null;

        if (!isNaN(parsedDailyPrice) && parsedDailyPrice >= 0) {
          insertPrice.run([productId, parsedDailyPrice, parsedPromoPrice, recordTime]);
          migratedCount++;
        } else {
          errorCount++;
          console.warn(`警告: 跳过无效价格记录 - ${packageName} @ ${recordTime}`);
        }
      }

      getProductId.reset();
    });

    getProductId.free();
    insertPrice.free();

    console.log(`✓ 已迁移 ${migratedCount} 条价格记录`);
    if (errorCount > 0) {
      console.log(`⚠ 跳过 ${errorCount} 条无效记录\n`);
    } else {
      console.log();
    }
  }

  console.log('步骤 6: 验证数据完整性...');
  const oldCount = db.exec('SELECT COUNT(*) as count FROM price_history')[0].values[0][0];
  const newCount = db.exec('SELECT COUNT(*) as count FROM price_history_v2')[0].values[0][0];
  const productCount = db.exec('SELECT COUNT(*) as count FROM products')[0].values[0][0];

  console.log(`原表记录数: ${oldCount}`);
  console.log(`新表记录数: ${newCount}`);
  console.log(`商品数量: ${productCount}`);

  if (newCount < oldCount * 0.95) {
    throw new Error('数据迁移不完整，迁移记录数少于原记录数的95%');
  }

  console.log('✓ 数据完整性验证通过\n');

  console.log('步骤 7: 保存数据库...');
  const data = db.export();
  fs.writeFileSync(DB_PATH, data);
  db.close();
  console.log('✓ 数据库已保存\n');

  console.log('=== 迁移完成 ===');
  console.log(`\n✅ 迁移成功！`);
  console.log(`   - 备份文件: ${BACKUP_PATH}`);
  console.log(`   - 商品数: ${productCount}`);
  console.log(`   - 价格记录: ${newCount}`);
  console.log(`\n⚠️  注意: 旧表 price_history 仍然存在`);
  console.log(`   验证无误后可以手动删除: DROP TABLE price_history;`);
}

migrate().catch(error => {
  console.error('\n❌ 迁移失败:', error.message);
  console.error('请检查备份文件并联系技术支持');
  process.exit(1);
});
