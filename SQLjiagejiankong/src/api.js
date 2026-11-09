const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./fileUtils');
const { parsePrice, classifyChange, isExceeded } = require('./priceCompare');
const notifier = require('./notifier');
const PriceDatabase = require('./database');

// 将路由参数解析为正整数，非法值（NaN、0、负数、非数字字符串）统一返回 null
function parsePositiveInt(value) {
  const n = parseInt(value, 10);
  if (!isFinite(n) || isNaN(n) || n < 1) return null;
  return n;
}


class PriceMonitorAPI {
  constructor(dbPath) {
    this.dbPath = path.resolve(dbPath);
    this.db = null;
    this.SQL = null;
    this.initError = null;   // 记录初始化失败原因，避免每次请求都重试
    this.fileSignature = null; // 当前内存数据对应的磁盘文件版本，用于发现导入进程写入的新数据
  }

  async init() {
    this.SQL = await initSqlJs();
    this.loadFromDisk();
  }

  // 磁盘文件版本：导入进程用"临时文件 + 重命名"保存，inode、修改时间或大小任一变化即视为新版本
  readFileSignature() {
    const stat = fs.statSync(this.dbPath);
    return `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  }

  // 从磁盘读取数据库到内存；新库校验通过后才替换旧库，失败时旧库保持可用
  loadFromDisk() {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`数据库文件不存在: ${this.dbPath}`);
    }

    let signature;
    let buffer;
    try {
      signature = this.readFileSignature();
      buffer = fs.readFileSync(this.dbPath);
    } catch (err) {
      throw new Error(`读取数据库文件失败: ${err.message}`);
    }

    let db;
    try {
      db = new this.SQL.Database(buffer);
    } catch (err) {
      throw new Error(`数据库文件损坏或格式不兼容: ${err.message}`);
    }

    try {
      db.run('PRAGMA foreign_keys = ON');

      // 验证关键表存在，防止用旧数据库文件启动
      const tables = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('products','skus','collection_batches','price_snapshots')"
      );
      const found = tables.length > 0 ? tables[0].values.map(r => r[0]) : [];
      const required = ['products', 'skus', 'collection_batches', 'price_snapshots'];
      const missing = required.filter(t => !found.includes(t));
      if (missing.length > 0) {
        throw new Error(`数据库缺少必要的表: ${missing.join(', ')}，请先运行迁移脚本`);
      }
    } catch (err) {
      db.close();
      throw err;
    }

    const oldDb = this.db;
    this.db = db;
    this.fileSignature = signature;
    if (oldDb) oldDb.close();
  }

  // 磁盘文件有变化（导入了新批次）时重新加载，返回是否重新加载
  refreshIfChanged() {
    if (this.readFileSignature() === this.fileSignature) return false;
    this.loadFromDisk();
    console.log('[API] 检测到数据库文件更新，已重新加载');
    return true;
  }

  getOverview() {
    const productCountResult = this.db.exec('SELECT COUNT(*) FROM products');
    const productCount = productCountResult[0].values[0][0];

    if (productCount === 0) {
      return {
        monitoredProductCount: 0,
        latestRecordTime: null,
        latestRecordTimeLabel: '最近价格记录',
        collectionStatus: 'unknown',
        hasComparableData: false,
        productsWithChanges: 0,
        priceChangeSummary: {
          increasedCount: 0,
          decreasedCount: 0,
          newPromoCount: 0,
          canceledPromoCount: 0
        }
      };
    }

    const latestBatchResult = this.db.exec(`
      SELECT MAX(imported_at) FROM collection_batches WHERE status = 'success'
    `);
    const latestRecordTime = latestBatchResult[0].values[0][0] || null;

    const batchesResult = this.db.exec(`
      SELECT id FROM collection_batches
      WHERE status = 'success'
      ORDER BY id DESC LIMIT 2
    `);

    const hasComparableData = batchesResult.length > 0 && batchesResult[0].values.length >= 2;

    let changeSummary = {
      increasedCount: 0,
      decreasedCount: 0,
      newPromoCount: 0,
      canceledPromoCount: 0
    };

    if (hasComparableData) {
      const [currentBatchId, previousBatchId] = batchesResult[0].values.map(row => row[0]);

      const thresholdResult = this.db.exec('SELECT price_threshold FROM products LIMIT 1');
      const threshold = thresholdResult[0].values[0][0];

      changeSummary.increasedCount = this.db.exec(`
        SELECT COUNT(*) FROM price_snapshots curr
        JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
        WHERE curr.batch_id = ? AND prev.batch_id = ?
          AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
          AND CAST(curr.promo_price AS REAL) - CAST(prev.promo_price AS REAL) > ?
      `, [currentBatchId, previousBatchId, threshold])[0].values[0][0];

      changeSummary.decreasedCount = this.db.exec(`
        SELECT COUNT(*) FROM price_snapshots curr
        JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
        WHERE curr.batch_id = ? AND prev.batch_id = ?
          AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
          AND CAST(prev.promo_price AS REAL) - CAST(curr.promo_price AS REAL) > ?
      `, [currentBatchId, previousBatchId, threshold])[0].values[0][0];

      changeSummary.newPromoCount = this.db.exec(`
        SELECT COUNT(*) FROM price_snapshots curr
        JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
        WHERE curr.batch_id = ? AND prev.batch_id = ?
          AND prev.promo_price IS NULL AND curr.promo_price IS NOT NULL
      `, [currentBatchId, previousBatchId])[0].values[0][0];

      changeSummary.canceledPromoCount = this.db.exec(`
        SELECT COUNT(*) FROM price_snapshots curr
        JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
        WHERE curr.batch_id = ? AND prev.batch_id = ?
          AND prev.promo_price IS NOT NULL AND curr.promo_price IS NULL
      `, [currentBatchId, previousBatchId])[0].values[0][0];
    }

    return {
      monitoredProductCount: productCount,
      latestRecordTime,
      latestRecordTimeLabel: '最近价格记录',
      collectionStatus: 'unknown',
      hasComparableData,
      productsWithChanges: this.countProductsWithChanges(),
      priceChangeSummary: changeSummary
    };
  }

  // 统计有超阈值活动价变动的商品数（商品粒度）
  // 每个商品独立取最近两个批次，任意 SKU 有变动即计 1
  countProductsWithChanges() {
    const products = this.db.exec('SELECT id, price_threshold FROM products');
    if (products.length === 0 || products[0].values.length === 0) return 0;

    let count = 0;
    for (const [productId, threshold] of products[0].values) {
      const batches = this.db.exec(`
        SELECT id FROM collection_batches
        WHERE product_id = ? AND status = 'success'
        ORDER BY id DESC LIMIT 2
      `, [productId]);

      if (batches.length === 0 || batches[0].values.length < 2) continue;

      const [currentId, previousId] = batches[0].values.map(r => r[0]);

      const changed = this.db.exec(`
        SELECT COUNT(*) FROM (
          SELECT curr.sku_id
          FROM price_snapshots curr
          JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
          WHERE curr.batch_id = ? AND prev.batch_id = ?
            AND (
              (curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
               AND ABS(CAST(curr.promo_price AS REAL) - CAST(prev.promo_price AS REAL)) > ?)
              OR (prev.promo_price IS NULL AND curr.promo_price IS NOT NULL)
              OR (prev.promo_price IS NOT NULL AND curr.promo_price IS NULL)
            )
          LIMIT 1
        )
      `, [currentId, previousId, threshold]);

      if (changed[0].values[0][0] > 0) count++;
    }
    return count;
  }

  getProducts() {
    const products = this.db.exec('SELECT id, product_url, platform_product_id, brand, display_name, page_title, price_threshold, shop_name, article_number FROM products');
    if (products.length === 0 || products[0].values.length === 0) return [];

    return products[0].values.map(([id, url, platformId, brand, displayName, pageTitle, threshold, shopName, articleNumber]) => {
      const skuCount = this.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [id])[0].values[0][0];

      const latestBatch = this.db.exec(`
        SELECT id, imported_at, status, completeness, inserted_record_count
        FROM collection_batches WHERE product_id = ? AND status = 'success'
        ORDER BY id DESC LIMIT 1
      `, [id]);

      const latest = latestBatch.length > 0 && latestBatch[0].values.length > 0
        ? { id: latestBatch[0].values[0][0], importedAt: latestBatch[0].values[0][1],
            status: latestBatch[0].values[0][2], completeness: latestBatch[0].values[0][3],
            insertedRecordCount: latestBatch[0].values[0][4] }
        : null;

      const batchesResult = this.db.exec(`
        SELECT id FROM collection_batches WHERE product_id = ? AND status = 'success'
        ORDER BY id DESC LIMIT 2
      `, [id]);

      let increasedCount = 0;
      let decreasedCount = 0;

      if (batchesResult.length > 0 && batchesResult[0].values.length >= 2) {
        const [currentId, previousId] = batchesResult[0].values.map(r => r[0]);
        increasedCount = this.db.exec(`
          SELECT COUNT(*) FROM price_snapshots curr
          JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
          WHERE curr.batch_id = ? AND prev.batch_id = ?
            AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
            AND CAST(curr.promo_price AS REAL) - CAST(prev.promo_price AS REAL) > ?
        `, [currentId, previousId, threshold])[0].values[0][0];

        decreasedCount = this.db.exec(`
          SELECT COUNT(*) FROM price_snapshots curr
          JOIN price_snapshots prev ON curr.sku_id = prev.sku_id
          WHERE curr.batch_id = ? AND prev.batch_id = ?
            AND curr.promo_price IS NOT NULL AND prev.promo_price IS NOT NULL
            AND CAST(prev.promo_price AS REAL) - CAST(curr.promo_price AS REAL) > ?
        `, [currentId, previousId, threshold])[0].values[0][0];
      }

      return { id, productUrl: url, platformProductId: platformId, brand, displayName, pageTitle,
               shopName, articleNumber, priceThreshold: threshold, skuCount, latestBatch: latest,
               priceChanges: { increasedCount, decreasedCount } };
    });
  }

  getProductById(id) {
    if (id === null) return null;

    const result = this.db.exec(
      'SELECT id, product_url, platform_product_id, brand, display_name, page_title, price_threshold, shop_name, article_number FROM products WHERE id = ?',
      [id]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;

    const [pid, url, platformId, brand, displayName, pageTitle, threshold, shopName, articleNumber] = result[0].values[0];
    const skuCount = this.db.exec('SELECT COUNT(*) FROM skus WHERE product_id = ?', [pid])[0].values[0][0];

    const batchesResult = this.db.exec(`
      SELECT id, imported_at, status, completeness, inserted_record_count
      FROM collection_batches WHERE product_id = ? AND status = 'success'
      ORDER BY id DESC LIMIT 2
    `, [pid]);

    const batches = batchesResult.length > 0 ? batchesResult[0].values : [];
    const latestBatch = batches[0] ? { id: batches[0][0], importedAt: batches[0][1],
      status: batches[0][2], completeness: batches[0][3], insertedRecordCount: batches[0][4] } : null;
    const previousBatch = batches[1] ? { id: batches[1][0], importedAt: batches[1][1],
      status: batches[1][2], completeness: batches[1][3], insertedRecordCount: batches[1][4] } : null;

    return { id: pid, productUrl: url, platformProductId: platformId, brand, displayName, pageTitle,
             shopName, articleNumber, priceThreshold: threshold, skuCount, latestBatch, previousBatch };
  }

  getBatches(productId) {
    if (productId === null) return null;

    const product = this.db.exec('SELECT id FROM products WHERE id = ?', [productId]);
    if (product.length === 0 || product[0].values.length === 0) return null;

    const result = this.db.exec(`
      SELECT id, imported_at, collected_at, status, completeness,
             source_record_count, inserted_record_count, error_message
      FROM collection_batches
      WHERE product_id = ?
      ORDER BY id DESC
    `, [productId]);

    if (result.length === 0 || result[0].values.length === 0) return [];

    return result[0].values.map(([id, importedAt, collectedAt, status, completeness,
                                   sourceCount, insertedCount, errorMsg]) => ({
      id, importedAt, collectedAt, status, completeness,
      sourceRecordCount: sourceCount,
      insertedRecordCount: insertedCount,
      errorMessage: errorMsg
    }));
  }

  getComparison(productId, currentBatchId, previousBatchId) {
    if (productId === null) return { error: 'INVALID_PRODUCT_ID' };

    const product = this.db.exec('SELECT id, price_threshold FROM products WHERE id = ?', [productId]);
    if (product.length === 0 || product[0].values.length === 0) {
      return { error: 'PRODUCT_NOT_FOUND' };
    }
    const threshold = product[0].values[0][1];

    let currentId = currentBatchId;
    if (!currentId) {
      const latest = this.db.exec(`
        SELECT id FROM collection_batches
        WHERE product_id = ? AND status = 'success'
        ORDER BY id DESC LIMIT 1
      `, [productId]);
      if (latest.length === 0 || latest[0].values.length === 0) {
        return { error: 'NO_BATCH', message: '该商品暂无采集数据' };
      }
      currentId = latest[0].values[0][0];
    }

    const batchCheck = this.db.exec('SELECT product_id FROM collection_batches WHERE id = ?', [currentId]);
    if (batchCheck.length === 0 || batchCheck[0].values.length === 0) {
      return { error: 'BATCH_NOT_FOUND' };
    }
    if (batchCheck[0].values[0][0] !== productId) {
      return { error: 'BATCH_NOT_BELONG_TO_PRODUCT' };
    }

    let previousId = previousBatchId;
    if (!previousId) {
      const prev = this.db.exec(`
        SELECT id FROM collection_batches
        WHERE product_id = ? AND status = 'success' AND id < ?
        ORDER BY id DESC LIMIT 1
      `, [productId, currentId]);
      if (prev.length === 0 || prev[0].values.length === 0) {
        return { error: 'NO_PREVIOUS_BATCH', message: '暂无可比数据，这可能是第一次采集' };
      }
      previousId = prev[0].values[0][0];
    }

    const prevBatchCheck = this.db.exec('SELECT product_id FROM collection_batches WHERE id = ?', [previousId]);
    if (prevBatchCheck.length === 0 || prevBatchCheck[0].values.length === 0) {
      return { error: 'PREVIOUS_BATCH_NOT_FOUND' };
    }
    if (prevBatchCheck[0].values[0][0] !== productId) {
      return { error: 'BATCH_NOT_BELONG_TO_PRODUCT' };
    }

    const rows = this.db.exec(`
      SELECT s.id, s.package_name, s.refraction, curr.promo_price, prev.promo_price
      FROM skus s
      LEFT JOIN price_snapshots curr ON curr.sku_id = s.id AND curr.batch_id = ?
      LEFT JOIN price_snapshots prev ON prev.sku_id = s.id AND prev.batch_id = ?
      WHERE s.product_id = ?
      ORDER BY s.id
    `, [currentId, previousId, productId]);

    const skus = rows.length > 0 ? rows[0].values : [];
    const result = {
      currentBatchId: currentId, previousBatchId: previousId, priceThreshold: threshold,
      summary: { increased: 0, decreased: 0, newPromo: 0, canceledPromo: 0, unchanged: 0, noPromo: 0 },
      skus: [],
      changes: []
    };

    const summaryKey = {
      no_promo: 'noPromo', promo_canceled: 'canceledPromo', new_promo: 'newPromo',
      increased: 'increased', decreased: 'decreased', unchanged: 'unchanged'
    };

    for (const [skuId, packageName, refraction, currentPromo, previousPromo] of skus) {
      const { changeType, changeAmount } = classifyChange(currentPromo, previousPromo, threshold);

      // 价格字符串损坏的 SKU 计入无活动价并跳过
      if (changeType === 'invalid') {
        result.summary.noPromo++;
        continue;
      }
      result.summary[summaryKey[changeType]]++;

      if (['increased', 'decreased', 'new_promo', 'promo_canceled'].includes(changeType)) {
        result.changes.push({ skuId, packageName, refraction, currentPromo, previousPromo, changeAmount, changeType });
      }

      // 所有 SKU 都加入 skus 数组（不管是否超阈值），供表格展示
      const currNum = parsePrice(currentPromo);
      const prevNum = parsePrice(previousPromo);
      result.skus.push({
        skuId,
        packageName,
        refraction,
        currentPromoPrice: currentPromo,
        previousPromoPrice: previousPromo,
        currentPromoPriceNum: currNum,
        previousPromoPriceNum: prevNum,
        priceChange: (currNum !== null && prevNum !== null) ? parseFloat((currNum - prevNum).toFixed(2)) : null,
        changeType
      });
    }

    return result;
  }

  // 手动推送：按网页上选中的两个批次对比，推送涨跌超过当前阈值的 SKU
  // 与网页"超阈值"标签使用同一份对比结果，网页上看到几条就推送几条
  async pushExceeded(productId, currentBatchId, previousBatchId) {
    if (!notifier.isConfigured()) {
      return { error: 'NOTIFIER_NOT_CONFIGURED', message: '未配置钉钉 Webhook，请在项目根目录 .env 中设置' };
    }

    const comparison = this.getComparison(productId, currentBatchId, previousBatchId);
    if (comparison.error) return comparison;

    const changes = comparison.changes
      .filter(c => isExceeded(c.changeType))
      .map(c => ({
        packageName: c.packageName,
        refraction: c.refraction,
        oldPromoPrice: c.previousPromo,
        newPromoPrice: c.currentPromo,
        changeAmount: c.changeAmount,
        changeType: c.changeType
      }));

    if (changes.length === 0) {
      return { sent: false, exceededCount: 0, message: `没有超过 ¥${comparison.priceThreshold} 阈值的 SKU，未发送` };
    }

    const context = PriceDatabase.readPushContext(
      this.db, productId, comparison.currentBatchId, comparison.previousBatchId
    );
    try {
      await notifier.notifyThresholdExceeded(context, changes, '网页手动推送');
    } catch (err) {
      return { error: 'PUSH_FAILED', message: err.message };
    }

    return { sent: true, exceededCount: changes.length, message: `已推送 ${changes.length} 个超阈值 SKU 到钉钉群` };
  }

  getBatchSkus(productId, batchId) {
    if (productId === null || batchId === null) {
      return { error: 'INVALID_PARAMS' };
    }

    const product = this.db.exec('SELECT id FROM products WHERE id = ?', [productId]);
    if (product.length === 0 || product[0].values.length === 0) {
      return { error: 'PRODUCT_NOT_FOUND' };
    }

    const batch = this.db.exec(
      'SELECT product_id, imported_at, status, completeness FROM collection_batches WHERE id = ?',
      [batchId]
    );
    if (batch.length === 0 || batch[0].values.length === 0) {
      return { error: 'BATCH_NOT_FOUND' };
    }
    if (batch[0].values[0][0] !== productId) {
      return { error: 'BATCH_NOT_BELONG_TO_PRODUCT' };
    }

    const [, importedAt, status, completeness] = batch[0].values[0];

    const rows = this.db.exec(`
      SELECT s.id, s.package_name, s.refraction, ps.daily_price, ps.promo_price
      FROM price_snapshots ps
      JOIN skus s ON ps.sku_id = s.id
      WHERE ps.batch_id = ?
      ORDER BY s.id
    `, [batchId]);

    const skus = rows.length > 0
      ? rows[0].values.map(([id, pkg, ref, daily, promo]) => ({
          id, packageName: pkg, refraction: ref, dailyPrice: daily, promoPrice: promo
        }))
      : [];

    return { batchId, importedAt, status, completeness, totalSkus: skus.length, skus };
  }

  updateSettings(productId, settings) {
    if (productId === null) return { error: 'INVALID_PRODUCT_ID' };

    const product = this.db.exec('SELECT id FROM products WHERE id = ?', [productId]);
    if (product.length === 0 || product[0].values.length === 0) {
      return { error: 'PRODUCT_NOT_FOUND' };
    }

    const { price_threshold, platform_product_id, display_name } = settings;

    // 校验 price_threshold（如果传了）
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

    // 校验 platform_product_id（如果传了）
    let idUpdate = false;
    let newPlatformId = null;
    if (platform_product_id !== undefined) {
      if (typeof platform_product_id !== 'string') {
        return { error: 'INVALID_PLATFORM_ID', message: 'platform_product_id 必须是字符串' };
      }
      if (platform_product_id.length > 100) {
        return { error: 'INVALID_PLATFORM_ID', message: 'platform_product_id 不能超过 100 字符' };
      }
      idUpdate = true;
      newPlatformId = platform_product_id;
    }

    // 校验 display_name（如果传了）
    let displayNameUpdate = false;
    let newDisplayName = null;
    if (display_name !== undefined) {
      if (display_name !== null && typeof display_name !== 'string') {
        return { error: 'INVALID_DISPLAY_NAME', message: 'display_name 必须是字符串或 null' };
      }
      if (display_name && display_name.length > 100) {
        return { error: 'INVALID_DISPLAY_NAME', message: 'display_name 不能超过 100 字符' };
      }
      displayNameUpdate = true;
      newDisplayName = display_name || null; // 空字符串转为 null
    }

    // 至少传一个字段
    if (!thresholdUpdate && !idUpdate && !displayNameUpdate) {
      return { error: 'NO_FIELDS', message: '至少需要更新一个字段' };
    }

    // 构造 SQL（原子性：所有校验通过后才执行 UPDATE）
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
    if (displayNameUpdate) {
      sets.push('display_name = ?');
      params.push(newDisplayName);
    }
    sets.push('updated_at = ?');
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    params.push(now);
    params.push(productId);

    // 写入前确保内存是磁盘上的最新版本，避免把旧数据整库写回、覆盖导入进程刚写入的批次
    this.refreshIfChanged();

    this.db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);

    // 修复 Bug：save() 写磁盘可能失败，单独捕获
    try {
      this.save();
    } catch (err) {
      return { error: 'SAVE_FAILED', message: `设置已在内存中更新，但写入磁盘失败: ${err.message}` };
    }

    const updated = this.db.exec(
      'SELECT platform_product_id, price_threshold, display_name FROM products WHERE id = ?',
      [productId]
    );
    const [updatedPlatformId, updatedThreshold, updatedDisplayName] = updated[0].values[0];

    return {
      success: true,
      platformProductId: updatedPlatformId,
      priceThreshold: updatedThreshold,
      displayName: updatedDisplayName
    };
  }

  save() {
    if (!this.db) return;
    writeFileAtomic(this.dbPath, this.db.export());
    // 自己写入的版本不需要再重新加载
    this.fileSignature = this.readFileSignature();
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// 将业务层的 error code 转换为 HTTP 状态码
function errorToStatus(errorCode) {
  switch (errorCode) {
    case 'PRODUCT_NOT_FOUND':
    case 'BATCH_NOT_FOUND':
    case 'PREVIOUS_BATCH_NOT_FOUND':
      return 404;
    case 'BATCH_NOT_BELONG_TO_PRODUCT':
    case 'INVALID_PRODUCT_ID':
    case 'INVALID_PARAMS':
    case 'INVALID_THRESHOLD':
    case 'NO_BATCH':
    case 'NO_PREVIOUS_BATCH':
      return 400;
    case 'SAVE_FAILED':
      return 500;
    case 'NOTIFIER_NOT_CONFIGURED':
      return 503;
    case 'PUSH_FAILED':
      return 502;
    default:
      return 500;
  }
}

function createRouter(dbPath) {
  const router = express.Router();
  const api = new PriceMonitorAPI(dbPath);
  let initDone = false;
  let initFailed = false;
  let initFailMessage = '';

  // 初始化中间件：只在第一次请求时初始化，失败后不再重试（避免每个请求都报同一个错）
  router.use(async (req, res, next) => {
    if (initDone) {
      // 每次请求检查数据库文件是否被导入进程更新，无需重启服务即可看到新数据
      try {
        api.refreshIfChanged();
      } catch (err) {
        // 重新加载失败时继续使用内存中的上一版数据，不中断查看
        console.error('[API] 重新加载数据库失败，继续使用上一版数据:', err.message);
      }
      return next();
    }

    if (initFailed) {
      return res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: `数据库不可用: ${initFailMessage}`
      });
    }

    try {
      await api.init();
      initDone = true;
      next();
    } catch (err) {
      initFailed = true;
      initFailMessage = err.message;
      return res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: `数据库初始化失败: ${err.message}`
      });
    }
  });

  router.get('/overview', (req, res) => {
    try {
      const result = api.getOverview();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'QUERY_FAILED', message: err.message });
    }
  });

  router.get('/products', (req, res) => {
    try {
      const result = api.getProducts();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'QUERY_FAILED', message: err.message });
    }
  });

  router.get('/products/:id', (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'INVALID_PRODUCT_ID', message: '商品 ID 必须是正整数' });
    }
    try {
      const result = api.getProductById(id);
      if (result === null) {
        return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: `商品 ${id} 不存在` });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'QUERY_FAILED', message: err.message });
    }
  });

  router.get('/products/:id/batches', (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'INVALID_PRODUCT_ID', message: '商品 ID 必须是正整数' });
    }
    try {
      const result = api.getBatches(id);
      if (result === null) {
        return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: `商品 ${id} 不存在` });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'QUERY_FAILED', message: err.message });
    }
  });

  router.get('/products/:id/comparison', (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'INVALID_PRODUCT_ID', message: '商品 ID 必须是正整数' });
    }

    const currentBatchId = req.query.current_batch_id
      ? parsePositiveInt(req.query.current_batch_id)
      : null;
    const previousBatchId = req.query.previous_batch_id
      ? parsePositiveInt(req.query.previous_batch_id)
      : null;

    // 如果传了参数但不合法，报错而不是静默忽略
    if (req.query.current_batch_id && currentBatchId === null) {
      return res.status(400).json({ error: 'INVALID_PARAMS', message: 'current_batch_id 必须是正整数' });
    }
    if (req.query.previous_batch_id && previousBatchId === null) {
      return res.status(400).json({ error: 'INVALID_PARAMS', message: 'previous_batch_id 必须是正整数' });
    }

    try {
      const result = api.getComparison(id, currentBatchId, previousBatchId);
      if (result.error) {
        return res.status(errorToStatus(result.error)).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'QUERY_FAILED', message: err.message });
    }
  });

  router.get('/products/:productId/batches/:batchId/skus', (req, res) => {
    const productId = parsePositiveInt(req.params.productId);
    const batchId = parsePositiveInt(req.params.batchId);

    if (productId === null) {
      return res.status(400).json({ error: 'INVALID_PRODUCT_ID', message: '商品 ID 必须是正整数' });
    }
    if (batchId === null) {
      return res.status(400).json({ error: 'INVALID_PARAMS', message: '批次 ID 必须是正整数' });
    }

    try {
      const result = api.getBatchSkus(productId, batchId);
      if (result.error) {
        return res.status(errorToStatus(result.error)).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'QUERY_FAILED', message: err.message });
    }
  });

  router.patch('/products/:id/settings', (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'INVALID_PRODUCT_ID', message: '商品 ID 必须是正整数' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'INVALID_BODY', message: '请求体必须是 JSON 对象' });
    }

    try {
      const result = api.updateSettings(id, req.body);
      if (result.error) {
        return res.status(errorToStatus(result.error)).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
    }
  });

  // 手动推送必须明确指定两个批次，不使用默认批次，避免推送的内容与页面所见不一致
  router.post('/products/:id/notify', async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'INVALID_PRODUCT_ID', message: '商品 ID 必须是正整数' });
    }
    const body = req.body || {};
    const currentBatchId = parsePositiveInt(body.current_batch_id);
    const previousBatchId = parsePositiveInt(body.previous_batch_id);
    if (currentBatchId === null || previousBatchId === null) {
      return res.status(400).json({ error: 'INVALID_PARAMS', message: '必须选择本次批次和对比批次' });
    }

    try {
      const result = await api.pushExceeded(id, currentBatchId, previousBatchId);
      if (result.error) {
        return res.status(errorToStatus(result.error)).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'PUSH_FAILED', message: err.message });
    }
  });

  router.get('/health', (req, res) => {
    try {
      const products = api.db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
      const batches = api.db.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
      const latest = api.db.exec(
        "SELECT MAX(imported_at) FROM collection_batches WHERE status = 'success'"
      )[0].values[0][0];

      res.json({ status: 'ok', products, totalBatches: batches, latestImport: latest || null });
    } catch (err) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // 未匹配路由
  router.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `接口 ${req.method} ${req.path} 不存在` });
  });

  return router;
}

module.exports = { PriceMonitorAPI, createRouter };
