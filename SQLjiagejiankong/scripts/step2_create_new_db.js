const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function createNewDatabase() {
  console.log('=== 第 2-3 步：创建新数据库并建立表结构 ===\n');

  const newDbPath = path.resolve('./data/price_monitor_new.db');

  // 检查是否已存在
  if (fs.existsSync(newDbPath)) {
    console.log('⚠️  新数据库已存在，将删除并重建');
    fs.unlinkSync(newDbPath);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  console.log('📁 创建新数据库: price_monitor_new.db\n');

  // 开启外键约束
  db.run('PRAGMA foreign_keys = ON');

  // 1. 创建商品表
  console.log('创建 products 表（商品表）...');
  db.run(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_url TEXT NOT NULL UNIQUE,
      platform_product_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      display_name TEXT,
      price_threshold REAL NOT NULL DEFAULT 5.0 CHECK(price_threshold >= 0),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX idx_products_brand ON products(brand)');

  // 2. 创建 SKU 表
  console.log('创建 skus 表（SKU 表）...');
  db.run(`
    CREATE TABLE skus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      package_name TEXT NOT NULL,
      refraction TEXT NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, package_name, refraction),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX idx_skus_product ON skus(product_id)');

  // 3. 创建批次表
  console.log('创建 collection_batches 表（批次表）...');
  db.run(`
    CREATE TABLE collection_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      collected_at DATETIME,
      status TEXT NOT NULL DEFAULT 'importing' CHECK(status IN ('importing', 'success', 'failed')),
      completeness TEXT NOT NULL DEFAULT 'unknown' CHECK(completeness IN ('unknown', 'complete', 'partial')),
      source_record_count INTEGER,
      inserted_record_count INTEGER,
      error_message TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX idx_batches_product ON collection_batches(product_id)');
  db.run('CREATE INDEX idx_batches_imported_at ON collection_batches(imported_at)');

  // 4. 创建价格快照表（使用 TEXT 存储价格）
  console.log('创建 price_snapshots 表（价格快照表）...');
  db.run(`
    CREATE TABLE price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      sku_id INTEGER NOT NULL,
      daily_price TEXT NOT NULL,
      promo_price TEXT,
      UNIQUE(batch_id, sku_id),
      FOREIGN KEY (batch_id) REFERENCES collection_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX idx_snapshots_batch ON price_snapshots(batch_id)');
  db.run('CREATE INDEX idx_snapshots_sku ON price_snapshots(sku_id)');

  console.log('\n=== 插入商品信息 ===\n');

  // 从 product-config.json 读取
  const configPath = './product-config.json';
  if (!fs.existsSync(configPath)) {
    console.error('❌ product-config.json 不存在');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('读取商品配置:');
  console.log('  品牌:', config.brand);
  console.log('  平台商品 ID:', config.product_id);
  console.log('  商品链接:', config.product_url);

  const insert = db.prepare(`
    INSERT INTO products (product_url, platform_product_id, brand, display_name, price_threshold)
    VALUES (?, ?, ?, ?, ?)
  `);

  insert.run([
    config.product_url,
    config.product_id,
    config.brand,
    null,
    5.0
  ]);
  insert.free();

  console.log('\n✅ 商品插入成功（ID: 1）');

  // 验证
  console.log('\n=== 验证新数据库结构 ===\n');

  const tables = db.exec(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    ORDER BY name
  `);

  console.log('数据库表列表:');
  tables[0].values.forEach(([name]) => console.log('  -', name));

  const fk = db.exec('PRAGMA foreign_keys');
  console.log('\n外键约束已开启:', fk[0].values[0][0] === 1);

  const productCount = db.exec('SELECT COUNT(*) FROM products');
  console.log('商品记录数:', productCount[0].values[0][0]);

  const skuCount = db.exec('SELECT COUNT(*) FROM skus');
  console.log('SKU 记录数:', skuCount[0].values[0][0]);

  const batchCount = db.exec('SELECT COUNT(*) FROM collection_batches');
  console.log('批次记录数:', batchCount[0].values[0][0]);

  const snapshotCount = db.exec('SELECT COUNT(*) FROM price_snapshots');
  console.log('价格快照数:', snapshotCount[0].values[0][0]);

  // 保存数据库
  fs.writeFileSync(newDbPath, db.export());
  db.close();

  console.log('\n✅ 新数据库创建完成:', newDbPath);
  console.log('\n📝 下一步: 运行 step3_migrate_data.js 迁移旧数据');
}

createNewDatabase().catch(err => {
  console.error('❌ 创建失败:', err.message);
  process.exit(1);
});
