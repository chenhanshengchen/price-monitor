const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { writeFileAtomic } = require('./fileUtils');
const { classifyChange, isExceeded } = require('./priceCompare');

// 生成稳定的北京时间字符串 "YYYY-MM-DD HH:MM:SS"
// 不依赖 toLocaleString 的格式（不同 Node 版本格式不同）
function getBeijingTimestamp() {
  const now = new Date();
  const offset = 8 * 60 * 60 * 1000;
  const bj = new Date(now.getTime() + offset);
  return bj.toISOString().replace('T', ' ').substring(0, 19);
}

// 店铺名、货号等文本：去掉首尾空格，空值统一为 null
function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

class PriceDatabase {
  constructor() {
    this.dbPath = path.resolve(config.paths.database);
    this.db = null;
    this.SQL = null;
  }

  async init() {
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.log('[Database] 数据库绝对路径:', this.dbPath);

    this.SQL = await initSqlJs();

    if (!fs.existsSync(this.dbPath)) {
      throw new Error('数据库文件不存在，请先运行迁移脚本');
    }

    let buffer;
    try {
      buffer = fs.readFileSync(this.dbPath);
    } catch (err) {
      throw new Error(`读取数据库文件失败: ${err.message}`);
    }

    try {
      this.db = new this.SQL.Database(buffer);
    } catch (err) {
      throw new Error(`数据库文件损坏或格式不兼容: ${err.message}`);
    }

    this.db.run('PRAGMA foreign_keys = ON');

    console.log('[Database] 已加载现有数据库');

    // 验证关键表存在
    const tables = this.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('products','skus','collection_batches','price_snapshots')"
    );
    const found = tables.length > 0 ? tables[0].values.map(r => r[0]) : [];
    const required = ['products', 'skus', 'collection_batches', 'price_snapshots'];
    const missing = required.filter(t => !found.includes(t));
    if (missing.length > 0) {
      throw new Error(`数据库缺少必要的表: ${missing.join(', ')}`);
    }

    // 统计全部商品和 SKU 数（不再绑定单个商品）
    const productCount = this.db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
    const skuCount = this.db.exec('SELECT COUNT(*) FROM skus')[0].values[0][0];
    const batchCount = this.db.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
    console.log('[Database] 商品数量:', productCount);
    console.log('[Database] SKU 数量:', skuCount);
    console.log('[Database] 批次数量:', batchCount);
  }

  // 按平台商品 ID 查找或注册商品
  // 已存在则更新 product_url、page_title 和 updated_at，不覆盖 display_name 和 price_threshold
  // shopName、articleNumber 为空时不覆盖已有值（页面偶尔未加载出来时避免清空）
  findOrCreateProduct(platformProductId, url, pageTitle, shopName, articleNumber) {
    if (!platformProductId || typeof platformProductId !== 'string') {
      throw new Error('platform_product_id 不能为空且必须是字符串');
    }

    // 截断超长标题
    let safeTitle = pageTitle;
    if (safeTitle && typeof safeTitle === 'string' && safeTitle.length > 1000) {
      console.warn('[Database] 商品标题过长，已截断为 1000 字符');
      safeTitle = safeTitle.substring(0, 1000);
    }

    // 查找已有商品
    const existing = this.db.exec(
      'SELECT id FROM products WHERE platform_product_id = ?',
      [platformProductId]
    );

    if (existing.length > 0 && existing[0].values.length > 0) {
      const productId = existing[0].values[0][0];
      const now = getBeijingTimestamp();

      // 更新 product_url、page_title 和 updated_at，不覆盖 display_name 和 price_threshold
      this.db.run(
        `UPDATE products SET product_url = ?, page_title = ?,
           shop_name = COALESCE(?, shop_name), article_number = COALESCE(?, article_number),
           updated_at = ? WHERE id = ?`,
        [url || '', safeTitle || null, cleanText(shopName), cleanText(articleNumber), now, productId]
      );

      console.log('[Database] 更新已有商品:', platformProductId, `(ID: ${productId})`);
      return productId;
    }

    // 注册新商品
    const now = getBeijingTimestamp();
    this.db.run(
      `INSERT INTO products (product_url, platform_product_id, brand, display_name, page_title, shop_name, article_number, price_threshold, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 5.0, ?, ?)`,
      [url || '', platformProductId, '未知品牌', safeTitle || null, cleanText(shopName), cleanText(articleNumber), now, now]
    );

    const result = this.db.exec('SELECT last_insert_rowid()');
    const productId = result[0].values[0][0];

    console.log('[Database] 注册新商品:', platformProductId, `(ID: ${productId})`);
    return productId;
  }

  createBatch(productId, sourceRecordCount) {
    if (!productId || typeof productId !== 'number' || productId < 1) {
      throw new Error('productId 参数必需且必须是正整数');
    }

    const now = getBeijingTimestamp();

    const insert = this.db.prepare(`
      INSERT INTO collection_batches
      (product_id, imported_at, status, completeness, source_record_count, inserted_record_count)
      VALUES (?, ?, 'importing', 'unknown', ?, 0)
    `);

    insert.run([productId, now, sourceRecordCount]);
    insert.free();

    const result = this.db.exec('SELECT last_insert_rowid()');
    const batchId = result[0].values[0][0];

    console.log('[Database] 创建新批次 ID:', batchId);
    return batchId;
  }

  findOrCreateSKU(productId, packageName, refraction) {
    if (!productId || typeof productId !== 'number' || productId < 1) {
      throw new Error('productId 参数必需且必须是正整数');
    }

    const normalizedRefraction = refraction || '';

    const result = this.db.exec(
      'SELECT id FROM skus WHERE product_id = ? AND package_name = ? AND refraction = ?',
      [productId, packageName, normalizedRefraction]
    );

    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0];
    }

    const insert = this.db.prepare(`
      INSERT INTO skus (product_id, package_name, refraction)
      VALUES (?, ?, ?)
    `);

    insert.run([productId, packageName, normalizedRefraction]);
    insert.free();

    const newId = this.db.exec('SELECT last_insert_rowid()');
    const skuId = newId[0].values[0][0];

    console.log('[Database] 创建新 SKU:', packageName, '|', normalizedRefraction, `(ID: ${skuId})`);
    return skuId;
  }

  insertPriceSnapshot(batchId, skuId, dailyPrice, promoPrice) {
    // 修复 Bug：UNIQUE(batch_id, sku_id) 冲突时会抛异常，捕获后记录警告，不中断整个批次
    try {
      const insert = this.db.prepare(`
        INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price)
        VALUES (?, ?, ?, ?)
      `);
      insert.run([batchId, skuId, dailyPrice, promoPrice]);
      insert.free();
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        console.warn(`[Database] 跳过重复记录: batch=${batchId} sku=${skuId}`);
      } else {
        throw err;
      }
    }
  }

  // 修复 Bug：分开处理 success 和 failed，传入 errorMessage
  completeBatch(batchId, insertedCount, success = true, errorMessage = null) {
    const update = this.db.prepare(`
      UPDATE collection_batches
      SET status = ?,
          inserted_record_count = ?,
          completeness = ?,
          error_message = ?
      WHERE id = ?
    `);

    update.run([
      success ? 'success' : 'failed',
      insertedCount,
      success ? 'complete' : 'unknown',
      errorMessage,
      batchId
    ]);
    update.free();
  }

  getLatestTwoBatches(productId) {
    if (!productId || typeof productId !== 'number' || productId < 1) {
      throw new Error('productId 参数必需且必须是正整数');
    }

    const result = this.db.exec(`
      SELECT id FROM collection_batches
      WHERE product_id = ? AND status = 'success'
      ORDER BY id DESC
      LIMIT 2
    `, [productId]);

    if (result.length === 0 || result[0].values.length === 0) {
      return { current: null, previous: null };
    }

    const batches = result[0].values.map(row => row[0]);
    return {
      current: batches[0] || null,
      previous: batches[1] || null
    };
  }

  getPriceChanges(productId, currentBatchId, previousBatchId) {
    if (!productId || typeof productId !== 'number' || productId < 1) {
      throw new Error('productId 参数必需且必须是正整数');
    }

    if (!previousBatchId) {
      return [];
    }

    // 获取该商品的价格阈值
    const productResult = this.db.exec('SELECT price_threshold FROM products WHERE id = ?', [productId]);
    if (productResult.length === 0 || productResult[0].values.length === 0) {
      throw new Error(`商品 ID ${productId} 不存在`);
    }
    const priceThreshold = productResult[0].values[0][0];

    const result = this.db.exec(`
      SELECT
        s.package_name,
        s.refraction,
        prev.promo_price AS old_promo,
        curr.promo_price AS new_promo
      FROM price_snapshots curr
      JOIN skus s ON curr.sku_id = s.id
      LEFT JOIN price_snapshots prev ON prev.sku_id = curr.sku_id AND prev.batch_id = ?
      WHERE curr.batch_id = ?
        AND s.product_id = ?
      ORDER BY s.id
    `, [previousBatchId, currentBatchId, productId]);

    if (result.length === 0 || result[0].values.length === 0) {
      return [];
    }

    // 与网页"超阈值"标签使用同一规则，只返回涨跌超过阈值的 SKU
    const changes = [];
    for (const [packageName, refraction, oldPromo, newPromo] of result[0].values) {
      const { changeType, changeAmount } = classifyChange(newPromo, oldPromo, priceThreshold);
      if (!isExceeded(changeType)) continue;
      changes.push({
        packageName,
        refraction,
        oldPromoPrice: oldPromo,
        newPromoPrice: newPromo,
        changeAmount,
        changeType
      });
    }
    return changes;
  }

  // 推送消息需要的商品名称、阈值和两个批次的时间
  getPushContext(productId, currentBatchId, previousBatchId) {
    return PriceDatabase.readPushContext(this.db, productId, currentBatchId, previousBatchId);
  }

  // 网页服务使用自己的数据库连接，因此提供传入连接的版本
  static readPushContext(db, productId, currentBatchId, previousBatchId) {
    const product = db.exec(
      'SELECT platform_product_id, display_name, page_title, price_threshold, shop_name, article_number FROM products WHERE id = ?',
      [productId]
    );
    if (product.length === 0 || product[0].values.length === 0) {
      throw new Error(`商品 ID ${productId} 不存在`);
    }
    const [platformProductId, displayName, pageTitle, priceThreshold, shopName, articleNumber] = product[0].values[0];

    const batchTime = (batchId) => {
      const r = db.exec('SELECT imported_at FROM collection_batches WHERE id = ?', [batchId]);
      return r.length > 0 && r[0].values.length > 0 ? r[0].values[0][0] : null;
    };

    return {
      productId,
      platformProductId,
      productName: displayName || pageTitle || platformProductId,
      priceThreshold,
      shopName,
      articleNumber,
      currentBatchTime: batchTime(currentBatchId),
      previousBatchTime: batchTime(previousBatchId)
    };
  }

  save() {
    if (!this.db) return;
    try {
      writeFileAtomic(this.dbPath, this.db.export());
      console.log('[Database] 数据库已保存到磁盘');
    } catch (err) {
      // 写入失败时记录详细错误，不静默丢失
      console.error('[Database] 保存失败:', err.message);
      throw err;
    }
  }

  close() {
    if (this.db) {
      try {
        this.save();
      } catch (err) {
        console.error('[Database] 关闭时保存失败，内存中的变更可能丢失:', err.message);
      }
      this.db.close();
      console.log('[Database] 数据库连接已关闭');
    }
  }
}

module.exports = PriceDatabase;
