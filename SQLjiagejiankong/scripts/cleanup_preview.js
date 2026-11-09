#!/usr/bin/env node
/**
 * 数据清理预览工具
 * 只读预览候选批次，不修改数据库
 */

const PriceDatabase = require('../src/database');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 可注入的当前时间（方便测试）
const CURRENT_TIME = process.env.PREVIEW_TIME
  ? new Date(process.env.PREVIEW_TIME)
  : new Date();

// 可覆盖的数据库路径（方便测试）
const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const DB_PATH = dbIndex !== -1 && args[dbIndex + 1]
  ? path.resolve(args[dbIndex + 1])
  : path.resolve(config.paths.database);

const TIMEZONE = 'Asia/Shanghai';

/**
 * 计算截止时间：前天 00:00:00（北京时间）
 * 保留今天、昨天、前天，删除更早的
 */
function calculateCutoffTime(now) {
  // 转换为北京时间的日期字符串（YYYY-MM-DD）
  const bjDate = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const year = bjDate.getFullYear();
  const month = String(bjDate.getMonth() + 1).padStart(2, '0');
  const day = String(bjDate.getDate()).padStart(2, '0');
  const todayBJ = `${year}-${month}-${day}`;

  // 前天 = 今天 - 2 天
  const twoDaysAgo = new Date(bjDate);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const cutoffYear = twoDaysAgo.getFullYear();
  const cutoffMonth = String(twoDaysAgo.getMonth() + 1).padStart(2, '0');
  const cutoffDay = String(twoDaysAgo.getDate()).padStart(2, '0');
  const cutoffBJ = `${cutoffYear}-${cutoffMonth}-${cutoffDay} 00:00:00`;

  return {
    nowISO: now.toISOString(),
    nowBJ: todayBJ,
    cutoffBJ,
    cutoffISO: new Date(cutoffBJ + ' GMT+0800').toISOString()
  };
}

/**
 * 生成计划 ID（基于时间戳和数据库路径）
 */
function generatePlanId(dbPath, timestamp) {
  const hash = crypto.createHash('sha256')
    .update(dbPath + timestamp.toISOString())
    .digest('hex')
    .substring(0, 8);
  return `cleanup_${timestamp.toISOString().split('T')[0]}_${hash}`;
}

/**
 * 计算内容校验摘要
 */
function calculateChecksum(data) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

/**
 * 预览清理候选
 */
async function previewCleanup() {
  const db = new PriceDatabase();

  // 覆盖数据库路径（用于测试）
  if (DB_PATH !== path.resolve(config.paths.database)) {
    db.dbPath = DB_PATH;
  }

  await db.init();

  console.log('=== 数据清理预览 ===\n');

  const times = calculateCutoffTime(CURRENT_TIME);
  const planId = generatePlanId(db.dbPath, CURRENT_TIME);

  console.log('数据库路径:', db.dbPath);
  console.log('数据库大小:', (fs.statSync(db.dbPath).size / 1024).toFixed(2), 'KB');
  console.log('计划 ID:', planId);
  console.log('计划创建时间:', times.nowISO);
  console.log('时区:', TIMEZONE);
  console.log('当前时间（北京）:', times.nowBJ);
  console.log('截止时间（北京）:', times.cutoffBJ);
  console.log('截止时间（UTC）:', times.cutoffISO);
  console.log('保留规则: 严格保留 >= 截止时间的批次\n');

  // 查询所有批次
  const allBatchesResult = db.db.exec(`
    SELECT id, product_id, imported_at, collected_at, status, completeness,
           source_record_count, inserted_record_count, error_message
    FROM collection_batches
    ORDER BY imported_at ASC
  `);

  const allBatches = allBatchesResult.length > 0 ? allBatchesResult[0].values : [];

  console.log('--- 批次分析 ---');
  console.log('总批次数:', allBatches.length, '\n');

  const candidates = [];
  const retained = [];
  const skipped = [];

  for (const batch of allBatches) {
    const [id, productId, importedAt, collectedAt, status, completeness,
           sourceCount, insertedCount, errorMsg] = batch;

    // 跳过正在导入的批次
    if (status === 'importing') {
      skipped.push({
        id, productId, importedAt, status, completeness, insertedCount,
        reason: '状态为 importing（正在导入）'
      });
      continue;
    }

    // 比较时间（数据库存储的是北京时间字符串，直接字符串比较）
    if (importedAt < times.cutoffBJ) {
      candidates.push({
        id, productId, importedAt, collectedAt, status, completeness,
        sourceCount, insertedCount, errorMsg
      });
    } else {
      retained.push({
        id, productId, importedAt, status, completeness, insertedCount
      });
    }
  }

  // 查询候选批次的价格快照数量
  const candidateBatchIds = candidates.map(b => b.id);
  let snapshotCounts = {};
  let totalSnapshots = 0;

  if (candidateBatchIds.length > 0) {
    const snapshotQuery = db.db.exec(`
      SELECT batch_id, COUNT(*) as count
      FROM price_snapshots
      WHERE batch_id IN (${candidateBatchIds.join(',')})
      GROUP BY batch_id
    `);

    if (snapshotQuery.length > 0) {
      snapshotQuery[0].values.forEach(([batchId, count]) => {
        snapshotCounts[batchId] = count;
        totalSnapshots += count;
      });
    }
  }

  // 按商品统计
  const productStats = {};
  for (const batch of candidates) {
    if (!productStats[batch.productId]) {
      productStats[batch.productId] = {
        productId: batch.productId,
        batchCount: 0,
        snapshotCount: 0,
        earliestTime: batch.importedAt,
        latestTime: batch.importedAt
      };
    }
    const stats = productStats[batch.productId];
    stats.batchCount++;
    stats.snapshotCount += snapshotCounts[batch.id] || 0;
    if (batch.importedAt < stats.earliestTime) stats.earliestTime = batch.importedAt;
    if (batch.importedAt > stats.latestTime) stats.latestTime = batch.importedAt;
  }

  console.log('--- 候选数据（将被删除）---');
  console.log('候选批次总数:', candidates.length);
  console.log('候选价格快照总数:', totalSnapshots);

  if (candidates.length > 0) {
    console.log('\n按商品统计:');
    Object.values(productStats).forEach(stats => {
      console.log(`  商品 ${stats.productId}: ${stats.batchCount} 个批次, ${stats.snapshotCount} 条快照`);
      console.log(`    时间范围: ${stats.earliestTime} ~ ${stats.latestTime}`);
    });

    console.log('\n候选批次列表:');
    candidates.forEach(b => {
      const snaps = snapshotCounts[b.id] || 0;
      console.log(`  批次 ${b.id}: ${b.importedAt} | 商品=${b.productId} | 状态=${b.status} | 快照=${snaps}条`);
    });
  } else {
    console.log('(无候选数据)\n');
  }

  console.log('\n--- 保留数据 ---');
  console.log('保留批次总数:', retained.length);
  if (retained.length > 0) {
    console.log('保留批次列表:');
    retained.forEach(b => {
      console.log(`  批次 ${b.id}: ${b.importedAt} | 商品=${b.productId} | 状态=${b.status} | 记录=${b.insertedCount}条`);
    });
  }

  if (skipped.length > 0) {
    console.log('\n--- 跳过的批次 ---');
    skipped.forEach(b => {
      console.log(`  批次 ${b.id}: ${b.importedAt} | 原因: ${b.reason}`);
    });
  }

  // 生成计划文件
  if (candidates.length > 0) {
    const planDir = path.join(__dirname, '../data/cleanup-plans');
    if (!fs.existsSync(planDir)) {
      fs.mkdirSync(planDir, { recursive: true });
    }

    const planFile = path.join(planDir, `${planId}.json`);
    const plan = {
      version: '1.0',
      planId,
      createdAt: times.nowISO,
      timezone: TIMEZONE,
      cutoffTimeBJ: times.cutoffBJ,
      cutoffTimeUTC: times.cutoffISO,
      database: {
        path: db.dbPath,
        size: fs.statSync(db.dbPath).size
      },
      rule: '保留今天、昨天、前天；删除严格早于截止时间的批次',
      candidates: {
        batches: candidates,
        totalBatches: candidates.length,
        totalSnapshots,
        productStats,
        checksumBatches: calculateChecksum(candidates),
        checksumSnapshots: calculateChecksum(snapshotCounts)
      },
      retained: {
        totalBatches: retained.length,
        batches: retained.map(b => ({ id: b.id, importedAt: b.importedAt, productId: b.productId }))
      },
      skipped: skipped.length > 0 ? skipped : undefined
    };

    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
    console.log('\n--- 计划文件 ---');
    console.log('已生成清理计划:', planFile);
    console.log('\n下一步:');
    console.log('  1. 归档: npm run cleanup:archive --plan', planFile);
    console.log('  2. 执行: npm run cleanup:execute --plan', planFile, '--archive <归档文件> --confirm', planId);
  } else {
    console.log('\n无可清理数据，不生成计划文件。');
  }

  db.close();
}

// 运行预览
previewCleanup().catch(err => {
  console.error('预览失败:', err);
  process.exit(1);
});
