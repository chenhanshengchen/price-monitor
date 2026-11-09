/**
 * 测试数据库初始化工具
 * 每次测试开始前创建一个干净的内存数据库，绝不触碰正式数据库
 */
const initSqlJs = require('sql.js');

async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run('PRAGMA foreign_keys = ON');

  // 建表（与正式库结构完全一致）
  db.run(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_url TEXT NOT NULL UNIQUE,
      platform_product_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      display_name TEXT,
      price_threshold REAL NOT NULL DEFAULT 5.0 CHECK(price_threshold >= 0),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      page_title TEXT,
      shop_name TEXT,
      article_number TEXT
    )
  `);

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

  db.run(`
    CREATE TABLE collection_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      collected_at DATETIME,
      status TEXT NOT NULL DEFAULT 'importing' CHECK(status IN ('importing','success','failed')),
      completeness TEXT NOT NULL DEFAULT 'unknown' CHECK(completeness IN ('unknown','complete','partial')),
      source_record_count INTEGER,
      inserted_record_count INTEGER,
      error_message TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

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

  return db;
}

/**
 * 向测试数据库插入标准的测试夹具
 * 返回插入后各行的 ID，方便测试代码引用
 */
function seedTestData(db) {
  // 商品
  db.run(`INSERT INTO products (product_url, platform_product_id, brand, price_threshold)
          VALUES ('https://test.tmall.com/item?id=111', '111', '蔡司', 5.0)`);
  const productId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // SKU A：有活动价变动
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (?, '套餐A', '1.56')`, [productId]);
  const skuA = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // SKU B：无活动价
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (?, '套餐B', '1.61')`, [productId]);
  const skuB = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // SKU C：活动价取消
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (?, '套餐C', '1.67')`, [productId]);
  const skuC = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // 批次 1（旧批次）
  db.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
          VALUES (?, '2026-10-25 05:00:00', 'success', 'complete', 3, 3)`, [productId]);
  const batch1 = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // 批次 1 价格：SKU A 活动价 100，SKU B 无活动价，SKU C 活动价 200
  db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (?, ?, '300', '100')`, [batch1, skuA]);
  db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (?, ?, '400', NULL)`, [batch1, skuB]);
  db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (?, ?, '500', '200')`, [batch1, skuC]);

  // 批次 2（最新批次）
  db.run(`INSERT INTO collection_batches (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
          VALUES (?, '2026-10-26 05:00:00', 'success', 'complete', 3, 3)`, [productId]);
  const batch2 = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // 批次 2 价格：SKU A 涨价到 120（超阈值5元），SKU B 无活动价，SKU C 活动价取消
  db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (?, ?, '300', '120')`, [batch2, skuA]);
  db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (?, ?, '400', NULL)`, [batch2, skuB]);
  db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (?, ?, '500', NULL)`, [batch2, skuC]);

  return { productId, skuA, skuB, skuC, batch1, batch2 };
}

module.exports = { createTestDb, seedTestData };
