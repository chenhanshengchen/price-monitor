-- ============================================
-- 数据库优化迁移脚本 V1
-- 执行日期: 2026-10-31
-- 目标: 修复数据类型、添加约束、优化查询性能
-- ============================================

-- 1. 创建商品主表
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL,
  refraction TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'discontinued')),
  CONSTRAINT unique_product UNIQUE(package_name, refraction)
);

-- 2. 创建新的价格历史表
CREATE TABLE IF NOT EXISTS price_history_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  daily_price REAL NOT NULL CHECK(daily_price >= 0),
  promo_price REAL CHECK(promo_price IS NULL OR promo_price >= 0),
  record_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  import_id INTEGER,
  CONSTRAINT unique_record UNIQUE(product_id, record_time),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 3. 创建数据导入追踪表
CREATE TABLE IF NOT EXISTS data_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'yingdao_rpa',
  record_count INTEGER,
  status TEXT CHECK(status IN ('success', 'partial', 'failed')),
  error_message TEXT
);

-- 4. 创建优化索引
CREATE INDEX IF NOT EXISTS idx_product_record ON price_history_v2(product_id, record_time DESC);
CREATE INDEX IF NOT EXISTS idx_record_time_v2 ON price_history_v2(record_time);
CREATE INDEX IF NOT EXISTS idx_promo_price ON price_history_v2(promo_price) WHERE promo_price IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_status ON products(status);

-- 5. 数据迁移脚本 (由 Node.js 执行)
-- 见 migrations/migrate_data.js

-- 6. 创建视图简化查询
CREATE VIEW IF NOT EXISTS latest_prices AS
SELECT
  p.id as product_id,
  p.package_name,
  p.refraction,
  ph.daily_price,
  ph.promo_price,
  ph.record_time
FROM products p
LEFT JOIN (
  SELECT
    product_id,
    daily_price,
    promo_price,
    record_time,
    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY record_time DESC) as rn
  FROM price_history_v2
) ph ON p.id = ph.product_id AND ph.rn = 1;

-- 7. 价格变动视图
CREATE VIEW IF NOT EXISTS price_changes AS
WITH current_prices AS (
  SELECT
    product_id,
    daily_price as curr_daily,
    promo_price as curr_promo,
    record_time as curr_time,
    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY record_time DESC) as rn
  FROM price_history_v2
),
previous_prices AS (
  SELECT
    product_id,
    daily_price as prev_daily,
    promo_price as prev_promo,
    record_time as prev_time,
    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY record_time DESC) as rn
  FROM price_history_v2
)
SELECT
  p.package_name,
  p.refraction,
  cp.curr_daily,
  cp.curr_promo,
  pp.prev_daily,
  pp.prev_promo,
  cp.curr_time,
  pp.prev_time,
  CASE
    WHEN pp.prev_promo IS NULL AND cp.curr_promo IS NOT NULL THEN 'new_promo'
    WHEN pp.prev_promo IS NOT NULL AND cp.curr_promo IS NULL THEN 'promo_removed'
    WHEN cp.curr_promo > pp.prev_promo THEN 'increased'
    WHEN cp.curr_promo < pp.prev_promo THEN 'decreased'
    ELSE 'unchanged'
  END as change_type,
  (cp.curr_promo - pp.prev_promo) as price_diff,
  CASE
    WHEN pp.prev_promo > 0 THEN ((cp.curr_promo - pp.prev_promo) / pp.prev_promo * 100)
    ELSE NULL
  END as price_change_percent
FROM products p
INNER JOIN current_prices cp ON p.id = cp.product_id AND cp.rn = 1
LEFT JOIN previous_prices pp ON p.id = pp.product_id AND pp.rn = 2
WHERE cp.curr_promo IS NOT NULL OR pp.prev_promo IS NOT NULL;

-- 8. 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS update_product_timestamp
AFTER UPDATE ON products
BEGIN
  UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- 9. 清理函数 (需要定期执行)
-- DELETE FROM price_history_v2
-- WHERE record_time < datetime('now', '-30 days');
