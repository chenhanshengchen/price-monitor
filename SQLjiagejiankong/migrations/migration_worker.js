/**
 * 数据迁移 Worker 线程
 * 每个 worker 独立处理一部分价格记录
 */

const { parentPort, workerData } = require('worker_threads');
const initSqlJs = require('sql.js');
const fs = require('fs');

async function migrateChunk() {
  const { dbPath, workerId, records, start, end } = workerData;

  try {
    // 加载数据库
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    let migratedCount = 0;
    let errorCount = 0;

    // 准备查询和插入语句
    const getProductId = db.prepare(
      'SELECT id FROM products WHERE package_name = ? AND refraction = ?'
    );

    const insertPrice = db.prepare(`
      INSERT OR IGNORE INTO price_history_v2
      (product_id, daily_price, promo_price, record_time)
      VALUES (?, ?, ?, ?)
    `);

    // 处理每条记录
    for (let i = 0; i < records.length; i++) {
      const [id, packageName, refraction, dailyPrice, promoPrice, recordTime] = records[i];

      try {
        // 查找 product_id
        getProductId.bind([packageName, refraction]);

        if (getProductId.step()) {
          const productId = getProductId.getAsObject().id;

          // 解析价格
          const parsedDailyPrice = parseFloat(dailyPrice) || 0;
          const parsedPromoPrice = promoPrice && promoPrice !== '' ? parseFloat(promoPrice) : null;

          if (!isNaN(parsedDailyPrice) && parsedDailyPrice >= 0) {
            insertPrice.run([productId, parsedDailyPrice, parsedPromoPrice, recordTime]);
            migratedCount++;
          } else {
            errorCount++;
          }
        } else {
          errorCount++;
        }

        getProductId.reset();

        // 定期报告进度
        if ((i + 1) % 10 === 0 || i === records.length - 1) {
          parentPort.postMessage({
            type: 'progress',
            workerId,
            processed: i + 1,
            total: records.length,
            percent: Math.round(((i + 1) / records.length) * 100)
          });
        }

      } catch (error) {
        errorCount++;
        // 继续处理下一条
      }
    }

    // 释放语句
    getProductId.free();
    insertPrice.free();

    // 保存数据库（每个worker独立写入自己的部分）
    const data = db.export();
    fs.writeFileSync(dbPath, data);
    db.close();

    // 报告完成
    parentPort.postMessage({
      type: 'complete',
      workerId,
      migrated: migratedCount,
      errors: errorCount,
      recordsProcessed: records.length
    });

  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      workerId,
      error: error.message
    });
    process.exit(1);
  }
}

migrateChunk();
