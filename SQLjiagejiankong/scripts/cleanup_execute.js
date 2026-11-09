#!/usr/bin/env node
/**
 * 数据清理执行工具
 * 校验计划和归档一致性后删除数据库记录
 */

const PriceDatabase = require('../src/database');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 可覆盖的数据库路径（方便测试）
const args = process.argv.slice(2);
const planIndex = args.indexOf('--plan');
const archiveIndex = args.indexOf('--archive');
const confirmIndex = args.indexOf('--confirm');
const dbIndex = args.indexOf('--db');
const DB_PATH = dbIndex !== -1 && args[dbIndex + 1]
  ? path.resolve(args[dbIndex + 1])
  : null;

function calculateChecksum(data) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

async function executeCleanup(planFile, archiveFile, confirmId) {
  if (!planFile || !fs.existsSync(planFile)) {
    console.error('错误: 计划文件不存在:', planFile);
    process.exit(1);
  }

  if (!archiveFile || !fs.existsSync(archiveFile)) {
    console.error('错误: 归档文件不存在:', archiveFile);
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));

  console.log('=== 数据清理执行 ===\n');
  console.log('计划 ID:', plan.planId);
  console.log('归档文件:', path.basename(archiveFile));
  console.log('确认 ID:', confirmId);

  if (confirmId !== plan.planId) {
    console.error('\n错误: 确认 ID 与计划 ID 不匹配');
    console.error('  计划:', plan.planId);
    console.error('  确认:', confirmId);
    process.exit(1);
  }

  if (archive.planId !== plan.planId) {
    console.error('\n错误: 归档的计划 ID 与计划文件不匹配');
    console.error('  计划:', plan.planId);
    console.error('  归档:', archive.planId);
    process.exit(1);
  }

  if (archive.version !== '1.0') {
    console.error('\n错误: 不支持的归档版本:', archive.version);
    process.exit(1);
  }

  console.log('\n--- 校验归档完整性 ---');
  const archiveBatchChecksum = calculateChecksum(archive.batches);
  if (archiveBatchChecksum !== archive.checksums.batches) {
    console.error('错误: 归档批次数据校验失败');
    process.exit(1);
  }
  console.log('归档批次校验: 通过');

  const archiveSnapshotChecksum = calculateChecksum(archive.snapshots);
  if (archiveSnapshotChecksum !== archive.checksums.snapshots) {
    console.error('错误: 归档快照数据校验失败');
    process.exit(1);
  }
  console.log('归档快照校验: 通过');

  const db = new PriceDatabase();

  if (DB_PATH) {
    db.dbPath = DB_PATH;
  }

  await db.init();

  console.log('\n--- 校验数据库身份 ---');
  if (db.dbPath !== plan.database.path) {
    console.error('错误: 数据库路径不匹配');
    console.error('  计划:', plan.database.path);
    console.error('  当前:', db.dbPath);
    db.close();
    process.exit(1);
  }
  console.log('数据库路径: 匹配');

  const candidateBatchIds = plan.candidates.batches.map(b => b.id);
  if (candidateBatchIds.length === 0) {
    console.log('\n无候选数据,无需删除');
    db.close();
    return;
  }

  console.log('\n--- 校验候选数据一致性 ---');

  for (const planBatch of plan.candidates.batches) {
    const current = db.db.exec(`
      SELECT id, product_id, imported_at, status, inserted_record_count
      FROM collection_batches WHERE id = ?
    `, [planBatch.id]);

    if (current.length === 0 || current[0].values.length === 0) {
      console.error(`错误: 批次 ${planBatch.id} 已不存在,候选数据已变化`);
      db.close();
      process.exit(1);
    }

    const [id, productId, importedAt, status, insertedCount] = current[0].values[0];

    if (status === 'importing') {
      console.error(`错误: 批次 ${planBatch.id} 状态变为 importing,禁止删除`);
      db.close();
      process.exit(1);
    }

    if (importedAt !== planBatch.importedAt) {
      console.error(`错误: 批次 ${planBatch.id} 导入时间已变化`);
      console.error('  计划:', planBatch.importedAt);
      console.error('  当前:', importedAt);
      db.close();
      process.exit(1);
    }

    if (importedAt >= plan.cutoffTimeBJ) {
      console.error(`错误: 批次 ${planBatch.id} 时间 ${importedAt} 不早于截止时间 ${plan.cutoffTimeBJ}`);
      db.close();
      process.exit(1);
    }
  }
  console.log('候选批次: 一致');

  const currentSnapshots = db.db.exec(`
    SELECT batch_id, COUNT(*) as count
    FROM price_snapshots
    WHERE batch_id IN (${candidateBatchIds.join(',')})
    GROUP BY batch_id
  `);

  const currentSnapshotCounts = {};
  let currentTotalSnapshots = 0;
  if (currentSnapshots.length > 0) {
    currentSnapshots[0].values.forEach(([batchId, count]) => {
      currentSnapshotCounts[batchId] = count;
      currentTotalSnapshots += count;
    });
  }

  if (currentTotalSnapshots !== plan.candidates.totalSnapshots) {
    console.error('错误: 候选快照数量已变化');
    console.error('  计划:', plan.candidates.totalSnapshots);
    console.error('  当前:', currentTotalSnapshots);
    db.close();
    process.exit(1);
  }
  console.log('候选快照数: 一致');

  console.log('\n--- 执行删除 ---');
  console.log('将删除:');
  console.log('  批次数:', candidateBatchIds.length);
  console.log('  快照数:', plan.candidates.totalSnapshots);

  try {
    db.db.exec('BEGIN EXCLUSIVE TRANSACTION');

    const snapshotResult = db.db.exec(`
      DELETE FROM price_snapshots
      WHERE batch_id IN (${candidateBatchIds.join(',')})
    `);

    const batchResult = db.db.exec(`
      DELETE FROM collection_batches
      WHERE id IN (${candidateBatchIds.join(',')})
    `);

    const verifyBatches = db.db.exec(`
      SELECT COUNT(*) as count FROM collection_batches
      WHERE id IN (${candidateBatchIds.join(',')})
    `);

    if (verifyBatches[0].values[0][0] !== 0) {
      throw new Error('批次未完全删除');
    }

    const verifySnapshots = db.db.exec(`
      SELECT COUNT(*) as count FROM price_snapshots
      WHERE batch_id IN (${candidateBatchIds.join(',')})
    `);

    if (verifySnapshots[0].values[0][0] !== 0) {
      throw new Error('快照未完全删除');
    }

    db.db.exec('COMMIT');
    console.log('删除成功');

  } catch (err) {
    db.db.exec('ROLLBACK');
    console.error('\n错误: 删除失败,已回滚');
    console.error(err.message);
    db.close();
    process.exit(1);
  }

  const logEntry = {
    planId: plan.planId,
    executedAt: new Date().toISOString(),
    database: db.dbPath,
    deletedBatches: candidateBatchIds.length,
    deletedSnapshots: plan.candidates.totalSnapshots,
    archiveFile,
    status: 'success'
  };

  const logDir = path.join(__dirname, '../data/cleanup-logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, `${plan.planId}_executed.json`);
  fs.writeFileSync(logFile, JSON.stringify(logEntry, null, 2));

  console.log('\n--- 完成 ---');
  console.log('执行日志:', logFile);
  console.log('归档文件:', archiveFile);

  const remaining = db.db.exec('SELECT COUNT(*) as count FROM collection_batches')[0].values[0][0];
  console.log('\n剩余批次数:', remaining);

  db.close();
}

// 参数解析（顶部已声明 args，这里只做校验）
if (planIndex === -1 || !args[planIndex + 1] ||
    archiveIndex === -1 || !args[archiveIndex + 1] ||
    confirmIndex === -1 || !args[confirmIndex + 1]) {
  console.error('用法: node cleanup_execute.js --plan <计划文件> --archive <归档文件> --confirm <计划ID> [--db <数据库路径>]');
  process.exit(1);
}

executeCleanup(
  args[planIndex + 1],
  args[archiveIndex + 1],
  args[confirmIndex + 1]
).catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
