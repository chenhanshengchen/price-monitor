#!/usr/bin/env node
/**
 * 并行数据库迁移工具
 * 使用 Worker Threads 实现并行数据转换
 * 策略：并行处理数据转换，串行写入数据库（SQLite限制）
 */

const { Worker } = require('worker_threads');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = path.resolve(__dirname, '../data/price_monitor.db');
const BACKUP_PATH = path.resolve(__dirname, `../data/price_monitor_backup_${Date.now()}.db`);
const WORKER_COUNT = Math.min(os.cpus().length - 1, 4) || 1; // 保留一个核心给主进程

class ParallelMigrator {
  constructor() {
    this.db = null;
    this.SQL = null;
  }

  async init() {
    console.log('=== 并行数据库迁移工具 ===\n');
    console.log(`CPU 核心数: ${os.cpus().length}`);
    console.log(`将使用 ${WORKER_COUNT} 个并行 worker\n`);

    // 步骤 1: 备份
    await this.backup();

    // 步骤 2: 加载数据库
    this.SQL = await initSqlJs();
    const buffer = fs.readFileSync(DB_PATH);
    this.db = new this.SQL.Database(buffer);
  }

  async backup() {
    console.log('步骤 1: 备份原数据库...');
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    console.log(`✓ 备份完成: ${BACKUP_PATH}\n`);
  }

  async createSchema() {
    console.log('步骤 2: 创建新表结构...');

    const migrationSQL = fs.readFileSync(
      path.resolve(__dirname, '001_optimize_schema.sql'),
      'utf8'
    );

    const statements = migrationSQL
      .split(';')
      .filter(s => s.trim() && !s.trim().startsWith('--'));

    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          this.db.run(stmt);
        } catch (e) {
          if (!e.message.includes('already exists')) {
            console.warn('警告:', e.message);
          }
        }
      }
    }

    console.log('✓ 表结构创建完成\n');
  }

  async migrateProducts() {
    console.log('步骤 3: 迁移商品数据到 products 表...');

    const result = this.db.exec(`
      SELECT DISTINCT package_name, refraction
      FROM price_history
      ORDER BY package_name, refraction
    `);

    if (result.length === 0 || result[0].values.length === 0) {
      console.log('⚠️  没有找到商品数据\n');
      return [];
    }

    const products = result[0].values;
    const insertStmt = this.db.prepare(
      'INSERT OR IGNORE INTO products (package_name, refraction) VALUES (?, ?)'
    );

    products.forEach(([packageName, refraction]) => {
      insertStmt.run([packageName, refraction]);
    });
    insertStmt.free();

    console.log(`✓ 已迁移 ${products.length} 个商品\n`);
    return products;
  }

  async migratePricesParallel() {
    console.log('步骤 4: 并行迁移价格历史数据...');

    // 4.1 获取所有价格记录
    const priceRecords = this.db.exec(`
      SELECT id, package_name, refraction, daily_price, promo_price, record_time
      FROM price_history
      ORDER BY id
    `);

    if (priceRecords.length === 0 || priceRecords[0].values.length === 0) {
      console.log('⚠️  没有价格数据需要迁移\n');
      return;
    }

    const allRecords = priceRecords[0].values;
    const totalRecords = allRecords.length;

    console.log(`总记录数: ${totalRecords}`);
    console.log(`分配到 ${WORKER_COUNT} 个 worker 并行处理...\n`);

    // 4.2 分割数据到各个 worker
    const chunkSize = Math.ceil(totalRecords / WORKER_COUNT);
    const chunks = [];

    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalRecords);
      if (start < totalRecords) {
        chunks.push({
          workerId: i + 1,
          records: allRecords.slice(start, end),
          start,
          end
        });
      }
    }

    // 4.3 先保存数据库状态（包含 products 表）
    this.saveDatabase();

    // 4.4 并行处理
    const startTime = Date.now();
    const results = await this.runWorkersInParallel(chunks);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // 4.5 汇总结果
    const totalMigrated = results.reduce((sum, r) => sum + r.migrated, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

    console.log(`\n✓ 并行处理完成，耗时: ${duration}秒`);
    console.log(`  成功迁移: ${totalMigrated} 条`);
    if (totalErrors > 0) {
      console.log(`  跳过错误: ${totalErrors} 条`);
    }
    console.log();

    return { totalMigrated, totalErrors };
  }

  async runWorkersInParallel(chunks) {
    return Promise.all(
      chunks.map(chunk => this.runWorker(chunk))
    );
  }

  runWorker(chunk) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.resolve(__dirname, 'migration_worker.js'), {
        workerData: {
          dbPath: DB_PATH,
          workerId: chunk.workerId,
          records: chunk.records,
          start: chunk.start,
          end: chunk.end
        }
      });

      worker.on('message', (result) => {
        if (result.type === 'progress') {
          process.stdout.write(`\rWorker ${result.workerId}: ${result.processed}/${result.total} (${result.percent}%)`);
        } else if (result.type === 'complete') {
          console.log(`\n✓ Worker ${result.workerId} 完成: ${result.migrated} 条记录`);
          resolve(result);
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker ${chunk.workerId} 异常退出，代码: ${code}`));
        }
      });
    });
  }

  async verify() {
    console.log('步骤 5: 验证数据完整性...');

    // 重新加载数据库以获取最新状态
    const buffer = fs.readFileSync(DB_PATH);
    this.db = new this.SQL.Database(buffer);

    const oldCount = this.db.exec('SELECT COUNT(*) as count FROM price_history')[0].values[0][0];
    const newCount = this.db.exec('SELECT COUNT(*) as count FROM price_history_v2')[0].values[0][0];
    const productCount = this.db.exec('SELECT COUNT(*) as count FROM products')[0].values[0][0];

    console.log(`原表记录数: ${oldCount}`);
    console.log(`新表记录数: ${newCount}`);
    console.log(`商品数量: ${productCount}`);

    if (newCount < oldCount * 0.95) {
      throw new Error('数据迁移不完整，迁移记录数少于原记录数的95%');
    }

    console.log('✓ 数据完整性验证通过\n');

    return { oldCount, newCount, productCount };
  }

  saveDatabase() {
    const data = this.db.export();
    fs.writeFileSync(DB_PATH, data);
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }

  async run() {
    try {
      await this.init();
      await this.createSchema();
      await this.migrateProducts();

      const migrationResult = await this.migratePricesParallel();
      const verifyResult = await this.verify();

      console.log('=== 迁移完成 ===');
      console.log(`\n✅ 迁移成功！`);
      console.log(`   - 备份文件: ${BACKUP_PATH}`);
      console.log(`   - 商品数: ${verifyResult.productCount}`);
      console.log(`   - 价格记录: ${verifyResult.newCount}`);
      console.log(`\n⚠️  注意: 旧表 price_history 仍然存在`);
      console.log(`   验证无误后可以手动删除: DROP TABLE price_history;`);

    } catch (error) {
      console.error('\n❌ 迁移失败:', error.message);
      console.error('请检查备份文件:', BACKUP_PATH);
      process.exit(1);
    } finally {
      this.close();
    }
  }
}

// 执行迁移
if (require.main === module) {
  const migrator = new ParallelMigrator();
  migrator.run().catch(console.error);
}

module.exports = ParallelMigrator;
