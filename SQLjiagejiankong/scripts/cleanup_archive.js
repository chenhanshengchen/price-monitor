#!/usr/bin/env node
/**
 * 数据清理归档工具
 * 根据计划文件导出候选数据为 JSON,不删除数据库记录
 */

const PriceDatabase = require('../src/database');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 可覆盖的数据库路径（方便测试）
const args = process.argv.slice(2);
const planIndex = args.indexOf('--plan');
const dbIndex = args.indexOf('--db');
const DB_PATH = dbIndex !== -1 && args[dbIndex + 1]
  ? path.resolve(args[dbIndex + 1])
  : null;

if (planIndex === -1 || !args[planIndex + 1]) {
  console.error('用法: node cleanup_archive.js --plan <计划文件路径> [--db <数据库路径>]');
  process.exit(1);
}

function calculateChecksum(data) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

async function archiveCleanup(planFile) {
  if (!planFile || !fs.existsSync(planFile)) {
    console.error('错误: 计划文件不存在:', planFile);
    console.error('用法: node cleanup_archive.js --plan <计划文件路径>');
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  console.log('=== 数据归档 ===\n');
  console.log('计划 ID:', plan.planId);
  console.log('数据库路径:', plan.database.path);
  console.log('候选批次数:', plan.candidates.totalBatches);
  console.log('候选快照数:', plan.candidates.totalSnapshots);
  console.log('\n正在导出数据...\n');

  const db = new PriceDatabase();

  // 覆盖数据库路径（用于测试）
  if (DB_PATH) {
    db.dbPath = DB_PATH;
  }

  await db.init();

  if (db.dbPath !== plan.database.path) {
    console.error('错误: 数据库路径不匹配');
    console.error('  计划中:', plan.database.path);
    console.error('  当前:', db.dbPath);
    db.close();
    process.exit(1);
  }

  const candidateBatchIds = plan.candidates.batches.map(b => b.id);
  if (candidateBatchIds.length === 0) {
    console.log('无候选数据,不生成归档文件');
    db.close();
    return;
  }

  const archive = {
    version: '1.0',
    schemaVersion: 'price_monitor_v2',
    planId: plan.planId,
    archivedAt: new Date().toISOString(),
    timezone: plan.timezone,
    cutoffTimeBJ: plan.cutoffTimeBJ,
    cutoffTimeUTC: plan.cutoffTimeUTC,
    database: plan.database,
    products: {},
    skus: {},
    batches: [],
    snapshots: [],
    stats: {
      productCount: 0,
      skuCount: 0,
      batchCount: 0,
      snapshotCount: 0
    }
  };

  const productIds = new Set();
  const skuIds = new Set();

  for (const batch of plan.candidates.batches) {
    productIds.add(batch.productId);

    const batchData = db.db.exec(`
      SELECT id, product_id, imported_at, collected_at, status, completeness,
             source_record_count, inserted_record_count, error_message
      FROM collection_batches WHERE id = ?
    `, [batch.id]);

    if (batchData.length === 0 || batchData[0].values.length === 0) {
      console.error(`警告: 批次 ${batch.id} 在数据库中不存在,跳过`);
      continue;
    }

    const [id, productId, importedAt, collectedAt, status, completeness,
           sourceCount, insertedCount, errorMsg] = batchData[0].values[0];

    archive.batches.push({
      id, productId, importedAt, collectedAt, status, completeness,
      sourceRecordCount: sourceCount,
      insertedRecordCount: insertedCount,
      errorMessage: errorMsg
    });

    const snapshots = db.db.exec(`
      SELECT id, batch_id, sku_id, daily_price, promo_price
      FROM price_snapshots WHERE batch_id = ?
    `, [batch.id]);

    if (snapshots.length > 0) {
      snapshots[0].values.forEach(([snapId, batchId, skuId, dailyPrice, promoPrice]) => {
        skuIds.add(skuId);
        archive.snapshots.push({
          id: snapId,
          batchId,
          skuId,
          dailyPrice,
          promoPrice
        });
      });
    }
  }

  Array.from(productIds).forEach(prodId => {
    const prod = db.db.exec(`
      SELECT id, product_url, platform_product_id, brand, display_name, price_threshold
      FROM products WHERE id = ?
    `, [prodId]);

    if (prod.length > 0 && prod[0].values.length > 0) {
      const [id, url, platformId, brand, displayName, threshold] = prod[0].values[0];
      archive.products[id] = {
        id, productUrl: url, platformProductId: platformId,
        brand, displayName, priceThreshold: threshold
      };
    }
  });

  Array.from(skuIds).forEach(skuId => {
    const sku = db.db.exec(`
      SELECT id, product_id, package_name, refraction
      FROM skus WHERE id = ?
    `, [skuId]);

    if (sku.length > 0 && sku[0].values.length > 0) {
      const [id, productId, packageName, refraction] = sku[0].values[0];
      archive.skus[id] = { id, productId, packageName, refraction };
    }
  });

  archive.stats.productCount = Object.keys(archive.products).length;
  archive.stats.skuCount = Object.keys(archive.skus).length;
  archive.stats.batchCount = archive.batches.length;
  archive.stats.snapshotCount = archive.snapshots.length;

  archive.checksums = {
    products: calculateChecksum(archive.products),
    skus: calculateChecksum(archive.skus),
    batches: calculateChecksum(archive.batches),
    snapshots: calculateChecksum(archive.snapshots)
  };

  if (archive.stats.batchCount !== plan.candidates.totalBatches) {
    console.error('错误: 归档批次数与计划不符');
    console.error('  计划:', plan.candidates.totalBatches);
    console.error('  实际:', archive.stats.batchCount);
    db.close();
    process.exit(1);
  }

  if (archive.stats.snapshotCount !== plan.candidates.totalSnapshots) {
    console.error('错误: 归档快照数与计划不符');
    console.error('  计划:', plan.candidates.totalSnapshots);
    console.error('  实际:', archive.stats.snapshotCount);
    db.close();
    process.exit(1);
  }

  const archiveDir = path.join(__dirname, '../data/archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const archiveFile = path.join(archiveDir, `${plan.planId}_${timestamp}.json`);
  const tempFile = archiveFile + '.tmp';

  fs.writeFileSync(tempFile, JSON.stringify(archive, null, 2));

  const readback = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
  if (calculateChecksum(readback.batches) !== archive.checksums.batches) {
    console.error('错误: 归档文件校验失败');
    fs.unlinkSync(tempFile);
    db.close();
    process.exit(1);
  }

  fs.renameSync(tempFile, archiveFile);

  console.log('--- 归档统计 ---');
  console.log('商品数:', archive.stats.productCount);
  console.log('SKU 数:', archive.stats.skuCount);
  console.log('批次数:', archive.stats.batchCount);
  console.log('快照数:', archive.stats.snapshotCount);
  console.log('\n归档文件:', archiveFile);
  console.log('文件大小:', (fs.statSync(archiveFile).size / 1024).toFixed(2), 'KB');
  console.log('\n下一步:');
  console.log('  执行删除: npm run cleanup:execute --plan', planFile, '--archive', archiveFile, '--confirm', plan.planId);

  db.close();
}

archiveCleanup(args[planIndex + 1]).catch(err => {
  console.error('归档失败:', err);
  process.exit(1);
});
