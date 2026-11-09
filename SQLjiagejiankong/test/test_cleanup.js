#!/usr/bin/env node
/**
 * 数据清理机制测试套件
 * 使用隔离测试数据库和固定时钟验证清理流程
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TEST_DB_DIR = path.join(__dirname, '../data/test-cleanup');
const SCRIPTS_DIR = path.join(__dirname, '../scripts');

// 测试计数器
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  期望: ${expected}\n  实际: ${actual}`);
  }
}

async function createTestDatabase(dbPath, batches) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run('PRAGMA foreign_keys = ON');

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

  db.run(`INSERT INTO products (product_url, brand, display_name, price_threshold)
          VALUES ('https://test.com/p1', '品牌A', '商品1', '50')`);
  db.run(`INSERT INTO products (product_url, brand, display_name, price_threshold)
          VALUES ('https://test.com/p2', '品牌B', '商品2', '30')`);

  // 为每个商品插入 2 个 SKU,共 4 个 SKU
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (1, 'SKU-1-1', '1.60')`);  // id=1
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (1, 'SKU-1-2', '1.67')`);  // id=2
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (2, 'SKU-2-1', '1.74')`);  // id=3
  db.run(`INSERT INTO skus (product_id, package_name, refraction) VALUES (2, 'SKU-2-2', '1.60')`);  // id=4

  for (const batch of batches) {
    db.run(`
      INSERT INTO collection_batches
      (product_id, imported_at, collected_at, status, completeness, inserted_record_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [batch.productId, batch.importedAt, batch.collectedAt || batch.importedAt,
        batch.status || 'success', batch.completeness || 'complete', batch.snapshotCount || 0]);

    const batchId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

    // 为该批次的商品分配对应 SKU(每个商品 2 个 SKU,交替使用)
    for (let i = 0; i < (batch.snapshotCount || 0); i++) {
      const baseSkuId = (batch.productId - 1) * 2 + 1;  // 商品1: 1,2  商品2: 3,4
      const skuId = baseSkuId + (i % 2);
      db.run(`
        INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price)
        VALUES (?, ?, ?, ?)
      `, [batchId, skuId, '100.00', '80.00']);
    }
  }

  const data = db.export();
  fs.writeFileSync(dbPath, data);
  db.close();
}

function runCommand(cmd, env = {}) {
  try {
    const output = execSync(cmd, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, ...env }
    });
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.stdout || '', error: err.stderr || err.message };
  }
}

async function test(name, fn) {
  process.stdout.write(`测试: ${name} ... `);
  try {
    await fn();
    console.log('✓');
    testsPassed++;
  } catch (err) {
    console.log('✗');
    console.log('  错误:', err.message);
    testsFailed++;
  }
}

async function runTests() {
  console.log('=== 数据清理机制测试套件 ===\n');

  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }

  await test('1. 三天保留规则: 今天、昨天、前天数据均保留', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test1.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-05 10:00:00', snapshotCount: 5 },
      { productId: 1, importedAt: '2026-11-04 10:00:00', snapshotCount: 5 },
      { productId: 1, importedAt: '2026-11-03 10:00:00', snapshotCount: 5 },
      { productId: 1, importedAt: '2026-11-02 23:59:59', snapshotCount: 5 }
    ]);

    const result = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);

    assert(result.success, '预览命令应成功执行');
    assert(result.output.includes('候选批次总数: 1'), '应只有 1 个候选批次(11-02)');
    assert(result.output.includes('保留批次总数: 3'), '应保留 3 个批次(11-03/04/05)');
  });

  await test('2. 边界时间: 截止时间之前的记录被纳入候选,等于截止时间的批次保留', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test2.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-03 00:00:01', snapshotCount: 3 },
      { productId: 1, importedAt: '2026-11-03 00:00:00', snapshotCount: 3 },
      { productId: 1, importedAt: '2026-11-02 23:59:59', snapshotCount: 3 }
    ]);

    const result = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);

    assert(result.success, '预览命令应成功执行');
    assert(result.output.includes('候选批次总数: 1'), '应只有 1 个候选批次(11-02 23:59:59)');
    assert(result.output.includes('保留批次总数: 2'), '应保留 2 个批次(00:00:00 和 00:00:01)');
  });

  await test('3. 多商品隔离: 候选与保留数据互不串联', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test3.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-02 10:00:00', snapshotCount: 4 },
      { productId: 1, importedAt: '2026-11-04 10:00:00', snapshotCount: 4 },
      { productId: 2, importedAt: '2026-11-01 10:00:00', snapshotCount: 4 },
      { productId: 2, importedAt: '2026-11-05 10:00:00', snapshotCount: 4 }
    ]);

    const result = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);

    assert(result.success, '预览命令应成功执行');
    assert(result.output.includes('商品 1: 1 个批次'), '商品 1 应有 1 个候选批次');
    assert(result.output.includes('商品 2: 1 个批次'), '商品 2 应有 1 个候选批次');
  });

  await test('4. 跳过 importing 状态批次', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test4.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', status: 'importing', snapshotCount: 0 },
      { productId: 1, importedAt: '2026-11-02 10:00:00', status: 'success', snapshotCount: 2 }
    ]);

    const result = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);

    assert(result.success, '预览命令应成功执行');
    assert(result.output.includes('跳过的批次'), '应显示跳过的批次');
    assert(result.output.includes('importing'), '应说明跳过原因为 importing');
    assert(result.output.includes('候选批次总数: 1'), '应只有 1 个候选批次(success 状态的)');
  });

  await test('5. 失败批次可安全清理', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test5.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', status: 'failed', snapshotCount: 0 },
      { productId: 1, importedAt: '2026-11-02 10:00:00', status: 'failed', snapshotCount: 2 }
    ]);

    const result = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);

    assert(result.success, '预览命令应成功执行');
    assert(result.output.includes('候选批次总数: 2'), '失败批次也应纳入候选');
  });

  await test('6. 预览不删除数据库记录', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test6.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', snapshotCount: 5 },
      { productId: 1, importedAt: '2026-11-04 10:00:00', snapshotCount: 5 }
    ]);

    const SQL = await initSqlJs();
    const beforeBuffer = fs.readFileSync(dbPath);
    const beforeDb = new SQL.Database(beforeBuffer);
    const beforeCount = beforeDb.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
    beforeDb.close();

    const dbModule = require('../src/database');
    const origPath = dbModule.prototype.dbPath;
    dbModule.prototype.dbPath = dbPath;

    runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js`);
    dbModule.prototype.dbPath = origPath;

    const afterBuffer = fs.readFileSync(dbPath);
    const afterDb = new SQL.Database(afterBuffer);
    const afterCount = afterDb.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
    afterDb.close();

    assertEquals(afterCount, beforeCount, '预览后批次数应不变');
  });

  await test('7. 完整流程: 预览 → 归档 → 执行', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test7.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', snapshotCount: 10 },
      { productId: 1, importedAt: '2026-11-04 10:00:00', snapshotCount: 10 }
    ]);

    const preview = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);
    assert(preview.success, '预览应成功');

    const planFileMatch = preview.output.match(/已生成清理计划: (.+\.json)/);
    assert(planFileMatch, '应生成计划文件');
    const planFile = planFileMatch[1];

    const archive = runCommand(`node ${SCRIPTS_DIR}/cleanup_archive.js --plan ${planFile} --db ${dbPath}`);
    assert(archive.success, '归档应成功');

    const archiveFileMatch = archive.output.match(/归档文件: (.+\.json)/);
    assert(archiveFileMatch, '应生成归档文件');
    const archiveFile = archiveFileMatch[1];

    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const execute = runCommand(`node ${SCRIPTS_DIR}/cleanup_execute.js --plan ${planFile} --archive ${archiveFile} --confirm ${plan.planId} --db ${dbPath}`);
    assert(execute.success, '执行应成功');

    const SQL = await initSqlJs();
    const finalBuffer = fs.readFileSync(dbPath);
    const finalDb = new SQL.Database(finalBuffer);
    const finalCount = finalDb.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
    finalDb.close();

    assertEquals(finalCount, 1, '执行后应只剩 1 个批次');
  });

  await test('8. 归档数量与计划一致', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test8.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', snapshotCount: 8 },
      { productId: 1, importedAt: '2026-11-04 10:00:00', snapshotCount: 4 }
    ]);

    const preview = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);
    const planFileMatch = preview.output.match(/已生成清理计划: (.+\.json)/);
    const planFile = planFileMatch[1];
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));

    const archive = runCommand(`node ${SCRIPTS_DIR}/cleanup_archive.js --plan ${planFile} --db ${dbPath}`);

    assert(archive.success, '归档应成功');
    assert(archive.output.includes('批次数: 1'), '应归档 1 个批次');
    assert(archive.output.includes('快照数: 8'), '应归档 8 条快照');

    const archiveFileMatch = archive.output.match(/归档文件: (.+\.json)/);
    const archiveData = JSON.parse(fs.readFileSync(archiveFileMatch[1], 'utf8'));
    assertEquals(archiveData.stats.batchCount, plan.candidates.totalBatches, '归档批次数应与计划一致');
    assertEquals(archiveData.stats.snapshotCount, plan.candidates.totalSnapshots, '归档快照数应与计划一致');
  });

  await test('9. 归档损坏时拒绝执行', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test9.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', snapshotCount: 2 }
    ]);

    const preview = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);
    const planFileMatch = preview.output.match(/已生成清理计划: (.+\.json)/);
    const planFile = planFileMatch[1];

    const archive = runCommand(`node ${SCRIPTS_DIR}/cleanup_archive.js --plan ${planFile} --db ${dbPath}`);
    const archiveFileMatch = archive.output.match(/归档文件: (.+\.json)/);
    const archiveFile = archiveFileMatch[1];

    // 损坏归档校验摘要
    const archiveData = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
    archiveData.checksums.batches = 'corrupted_checksum';
    fs.writeFileSync(archiveFile, JSON.stringify(archiveData));

    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const execute = runCommand(`node ${SCRIPTS_DIR}/cleanup_execute.js --plan ${planFile} --archive ${archiveFile} --confirm ${plan.planId} --db ${dbPath}`);

    assert(!execute.success, '归档损坏时应拒绝执行');
    assert(
      execute.output.includes('校验失败') || execute.error.includes('校验失败'),
      '应提示校验失败'
    );
  });

  await test('10. 计划与数据库不一致时拒绝执行', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test10.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', snapshotCount: 2 }
    ]);

    const preview = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);
    const planFileMatch = preview.output.match(/已生成清理计划: (.+\.json)/);
    const planFile = planFileMatch[1];

    const archive = runCommand(`node ${SCRIPTS_DIR}/cleanup_archive.js --plan ${planFile} --db ${dbPath}`);
    const archiveFileMatch = archive.output.match(/归档文件: (.+\.json)/);
    const archiveFile = archiveFileMatch[1];

    // 归档后向候选批次追加快照，使数据库与计划不一致
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    db.run(`INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price) VALUES (1, 1, '999', '888')`);
    fs.writeFileSync(dbPath, db.export());
    db.close();

    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const execute = runCommand(`node ${SCRIPTS_DIR}/cleanup_execute.js --plan ${planFile} --archive ${archiveFile} --confirm ${plan.planId} --db ${dbPath}`);

    assert(!execute.success, '数据变化时应拒绝执行');
    assert(
      execute.output.includes('已变化') || execute.error.includes('已变化'),
      '应提示数据已变化'
    );
  });

  await test('11. 恢复功能正确', async () => {
    const sourceDbPath = path.join(TEST_DB_DIR, 'test11_source.db');
    const targetDbPath = path.join(TEST_DB_DIR, 'test11_target.db');
    if (fs.existsSync(targetDbPath)) fs.unlinkSync(targetDbPath);

    await createTestDatabase(sourceDbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', snapshotCount: 4 },
      { productId: 1, importedAt: '2026-11-04 10:00:00', snapshotCount: 4 }
    ]);

    const preview = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${sourceDbPath}`);
    const planFileMatch = preview.output.match(/已生成清理计划: (.+\.json)/);
    const planFile = planFileMatch[1];

    const archive = runCommand(`node ${SCRIPTS_DIR}/cleanup_archive.js --plan ${planFile} --db ${sourceDbPath}`);
    const archiveFileMatch = archive.output.match(/归档文件: (.+\.json)/);
    const archiveFile = archiveFileMatch[1];

    const restore = runCommand(`node ${SCRIPTS_DIR}/cleanup_restore.js --archive ${archiveFile} --db ${targetDbPath}`);
    assert(restore.success, '恢复应成功');

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(targetDbPath);
    const db = new SQL.Database(buffer);
    const batchCount = db.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
    const snapshotCount = db.exec('SELECT COUNT(*) FROM price_snapshots')[0].values[0][0];
    db.close();

    assertEquals(batchCount, 1, '恢复后应有 1 个批次');
    assertEquals(snapshotCount, 4, '恢复后应有 4 条快照');
  });

  await test('12. 商品和 SKU 保持不变', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'test12.db');
    await createTestDatabase(dbPath, [
      { productId: 1, importedAt: '2026-11-01 10:00:00', snapshotCount: 4 },
      { productId: 1, importedAt: '2026-11-04 10:00:00', snapshotCount: 4 }
    ]);

    const SQL = await initSqlJs();
    let buffer = fs.readFileSync(dbPath);
    let db = new SQL.Database(buffer);
    const beforeProducts = db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
    const beforeSkus = db.exec('SELECT COUNT(*) FROM skus')[0].values[0][0];
    db.close();

    const preview = runCommand(`PREVIEW_TIME="2026-11-05T10:00:00" node ${SCRIPTS_DIR}/cleanup_preview.js --db ${dbPath}`);
    const planFileMatch = preview.output.match(/已生成清理计划: (.+\.json)/);
    const planFile = planFileMatch[1];

    const archive = runCommand(`node ${SCRIPTS_DIR}/cleanup_archive.js --plan ${planFile} --db ${dbPath}`);
    const archiveFileMatch = archive.output.match(/归档文件: (.+\.json)/);
    const archiveFile = archiveFileMatch[1];

    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    runCommand(`node ${SCRIPTS_DIR}/cleanup_execute.js --plan ${planFile} --archive ${archiveFile} --confirm ${plan.planId} --db ${dbPath}`);

    buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
    const afterProducts = db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
    const afterSkus = db.exec('SELECT COUNT(*) FROM skus')[0].values[0][0];
    db.close();

    assertEquals(afterProducts, beforeProducts, '商品数应不变');
    assertEquals(afterSkus, beforeSkus, 'SKU 数应不变');
  });

  console.log('\n=== 测试完成 ===');
  console.log(`通过: ${testsPassed}`);
  console.log(`失败: ${testsFailed}`);
  console.log(`总计: ${testsPassed + testsFailed}`);

  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
