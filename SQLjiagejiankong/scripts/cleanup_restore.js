#!/usr/bin/env node
/**
 * 数据清理恢复工具
 * 从归档文件恢复数据到测试数据库
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function calculateChecksum(data) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

async function restoreFromArchive(archiveFile, targetDbPath) {
  if (!archiveFile || !fs.existsSync(archiveFile)) {
    console.error('错误: 归档文件不存在:', archiveFile);
    process.exit(1);
  }

  console.log('=== 数据恢复 ===\n');
  console.log('归档文件:', archiveFile);
  console.log('目标数据库:', targetDbPath);

  const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));

  console.log('\n--- 校验归档 ---');
  if (archive.version !== '1.0') {
    console.error('错误: 不支持的归档版本:', archive.version);
    process.exit(1);
  }
  console.log('归档版本:', archive.version);
  console.log('计划 ID:', archive.planId);
  console.log('归档时间:', archive.archivedAt);

  const batchChecksum = calculateChecksum(archive.batches);
  if (batchChecksum !== archive.checksums.batches) {
    console.error('错误: 归档批次数据校验失败');
    process.exit(1);
  }
  console.log('批次数据校验: 通过');

  const snapshotChecksum = calculateChecksum(archive.snapshots);
  if (snapshotChecksum !== archive.checksums.snapshots) {
    console.error('错误: 归档快照数据校验失败');
    process.exit(1);
  }
  console.log('快照数据校验: 通过');

  console.log('\n--- 归档统计 ---');
  console.log('商品数:', archive.stats.productCount);
  console.log('SKU 数:', archive.stats.skuCount);
  console.log('批次数:', archive.stats.batchCount);
  console.log('快照数:', archive.stats.snapshotCount);

  const SQL = await initSqlJs();
  let db;

  if (fs.existsSync(targetDbPath)) {
    console.log('\n目标数据库已存在,加载现有数据库');
    const buffer = fs.readFileSync(targetDbPath);
    db = new SQL.Database(buffer);
  } else {
    console.log('\n创建新数据库');
    db = new SQL.Database();

    db.run(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_url TEXT NOT NULL UNIQUE,
        platform_product_id TEXT,
        brand TEXT,
        display_name TEXT,
        price_threshold TEXT
      )
    `);

    db.run(`
      CREATE TABLE skus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        package_name TEXT NOT NULL,
        refraction TEXT,
        FOREIGN KEY (product_id) REFERENCES products(id),
        UNIQUE(product_id, package_name)
      )
    `);

    db.run(`
      CREATE TABLE collection_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        collected_at TEXT,
        status TEXT NOT NULL DEFAULT 'importing',
        completeness TEXT DEFAULT 'unknown',
        source_record_count INTEGER,
        inserted_record_count INTEGER DEFAULT 0,
        error_message TEXT,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    db.run(`
      CREATE TABLE price_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        sku_id INTEGER NOT NULL,
        daily_price TEXT,
        promo_price TEXT,
        FOREIGN KEY (batch_id) REFERENCES collection_batches(id),
        FOREIGN KEY (sku_id) REFERENCES skus(id)
      )
    `);
  }

  db.run('PRAGMA foreign_keys = ON');
  db.run('BEGIN TRANSACTION');

  try {
    console.log('\n--- 恢复数据 ---');

    const productIdMap = {};
    const skuIdMap = {};
    const batchIdMap = {};

    console.log('恢复商品...');
    for (const [oldId, prod] of Object.entries(archive.products)) {
      const existing = db.exec(`
        SELECT id FROM products WHERE product_url = ?
      `, [prod.productUrl]);

      if (existing.length > 0 && existing[0].values.length > 0) {
        productIdMap[oldId] = existing[0].values[0][0];
        console.log(`  商品 ${oldId} 已存在 (新 ID: ${productIdMap[oldId]})`);
      } else {
        db.run(`
          INSERT INTO products (product_url, platform_product_id, brand, display_name, price_threshold)
          VALUES (?, ?, ?, ?, ?)
        `, [prod.productUrl, prod.platformProductId, prod.brand, prod.displayName, prod.priceThreshold]);

        const newId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        productIdMap[oldId] = newId;
        console.log(`  商品 ${oldId} → ${newId}`);
      }
    }

    console.log('恢复 SKU...');
    for (const [oldId, sku] of Object.entries(archive.skus)) {
      const newProductId = productIdMap[sku.productId];
      if (!newProductId) {
        console.error(`  错误: SKU ${oldId} 的商品 ${sku.productId} 未找到映射`);
        throw new Error('商品映射缺失');
      }

      const existing = db.exec(`
        SELECT id FROM skus WHERE product_id = ? AND package_name = ? AND refraction = ?
      `, [newProductId, sku.packageName, sku.refraction || '']);

      if (existing.length > 0 && existing[0].values.length > 0) {
        skuIdMap[oldId] = existing[0].values[0][0];
      } else {
        db.run(`
          INSERT INTO skus (product_id, package_name, refraction)
          VALUES (?, ?, ?)
        `, [newProductId, sku.packageName, sku.refraction]);

        const newId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        skuIdMap[oldId] = newId;
      }
    }
    console.log(`  已恢复 ${Object.keys(skuIdMap).length} 个 SKU`);

    console.log('恢复批次...');
    for (const batch of archive.batches) {
      const newProductId = productIdMap[batch.productId];
      if (!newProductId) {
        console.error(`  错误: 批次 ${batch.id} 的商品 ${batch.productId} 未找到映射`);
        throw new Error('商品映射缺失');
      }

      db.run(`
        INSERT INTO collection_batches
        (product_id, imported_at, collected_at, status, completeness,
         source_record_count, inserted_record_count, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [newProductId, batch.importedAt, batch.collectedAt, batch.status,
          batch.completeness, batch.sourceRecordCount, batch.insertedRecordCount,
          batch.errorMessage]);

      const newId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      batchIdMap[batch.id] = newId;
    }
    console.log(`  已恢复 ${archive.batches.length} 个批次`);

    console.log('恢复价格快照...');
    let snapshotCount = 0;
    for (const snap of archive.snapshots) {
      const newBatchId = batchIdMap[snap.batchId];
      const newSkuId = skuIdMap[snap.skuId];

      if (!newBatchId || !newSkuId) {
        console.error(`  错误: 快照 ${snap.id} 的批次/SKU 映射缺失`);
        throw new Error('批次或 SKU 映射缺失');
      }

      db.run(`
        INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price)
        VALUES (?, ?, ?, ?)
      `, [newBatchId, newSkuId, snap.dailyPrice, snap.promoPrice]);

      snapshotCount++;
    }
    console.log(`  已恢复 ${snapshotCount} 条快照`);

    db.run('COMMIT');
    console.log('\n事务提交成功');

  } catch (err) {
    db.run('ROLLBACK');
    console.error('\n错误: 恢复失败,已回滚');
    console.error(err.message);
    process.exit(1);
  }

  const data = db.export();
  fs.writeFileSync(targetDbPath, data);
  console.log('\n数据库已保存:', targetDbPath);

  const finalStats = {
    products: db.exec('SELECT COUNT(*) FROM products')[0].values[0][0],
    skus: db.exec('SELECT COUNT(*) FROM skus')[0].values[0][0],
    batches: db.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0],
    snapshots: db.exec('SELECT COUNT(*) FROM price_snapshots')[0].values[0][0]
  };

  console.log('\n--- 恢复后统计 ---');
  console.log('商品总数:', finalStats.products);
  console.log('SKU 总数:', finalStats.skus);
  console.log('批次总数:', finalStats.batches);
  console.log('快照总数:', finalStats.snapshots);

  db.close();
}

const args = process.argv.slice(2);
const archiveIndex = args.indexOf('--archive');
const dbIndex = args.indexOf('--db');

if (archiveIndex === -1 || !args[archiveIndex + 1] ||
    dbIndex === -1 || !args[dbIndex + 1]) {
  console.error('用法: node cleanup_restore.js --archive <归档文件> --db <目标数据库>');
  process.exit(1);
}

restoreFromArchive(
  args[archiveIndex + 1],
  args[dbIndex + 1]
).catch(err => {
  console.error('恢复失败:', err);
  process.exit(1);
});
