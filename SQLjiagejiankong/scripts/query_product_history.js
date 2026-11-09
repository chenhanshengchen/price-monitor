#!/usr/bin/env node
/**
 * 查询指定商品的历史价格变动
 * 用法: node query_product_history.js [天数]
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/price_monitor.db');
const days = process.argv[2] || 3; // 默认查询3天

async function queryHistory() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  console.log(`\n=== 查询最近 ${days} 天的价格变动 ===\n`);

  // 1. 获取所有SKU列表
  const skus = db.exec(`
    SELECT DISTINCT package_name, refraction
    FROM price_history
    ORDER BY package_name, refraction
  `);

  if (skus.length === 0 || skus[0].values.length === 0) {
    console.log('数据库中没有数据');
    db.close();
    return;
  }

  console.log(`找到 ${skus[0].values.length} 个不同的SKU\n`);

  // 2. 对每个SKU，查询历史价格
  const productsWithChanges = [];

  skus[0].values.forEach(([packageName, refraction], index) => {
    const history = db.exec(`
      SELECT
        record_time,
        daily_price,
        promo_price
      FROM price_history
      WHERE package_name = ?
        AND refraction = ?
        AND record_time >= datetime('now', '-' || ? || ' days', 'localtime')
      ORDER BY record_time ASC
    `, [packageName, refraction, days]);

    if (history.length > 0 && history[0].values.length > 0) {
      const records = history[0].values;

      // 检查是否有价格变动
      let hasChange = false;
      const changes = [];

      for (let i = 1; i < records.length; i++) {
        const prev = records[i - 1];
        const curr = records[i];

        const [prevTime, prevDaily, prevPromo] = prev;
        const [currTime, currDaily, currPromo] = curr;

        if (prevDaily !== currDaily || prevPromo !== currPromo) {
          hasChange = true;
          changes.push({
            from: { time: prevTime, daily: prevDaily, promo: prevPromo },
            to: { time: currTime, daily: currDaily, promo: currPromo }
          });
        }
      }

      if (hasChange) {
        productsWithChanges.push({
          packageName: packageName.substring(0, 60),
          refraction,
          recordCount: records.length,
          changes
        });
      }
    }
  });

  // 3. 输出有价格变动的商品
  if (productsWithChanges.length === 0) {
    console.log(`✅ 最近 ${days} 天内所有商品价格保持稳定，无变动\n`);
  } else {
    console.log(`⚠️  发现 ${productsWithChanges.length} 个商品有价格变动：\n`);

    productsWithChanges.forEach((product, idx) => {
      console.log(`${idx + 1}. ${product.packageName}`);
      console.log(`   折射率: ${product.refraction}`);
      console.log(`   记录数: ${product.recordCount} 次`);
      console.log(`   价格变动:`);

      product.changes.forEach((change, i) => {
        console.log(`   ${i + 1}) ${change.from.time} → ${change.to.time}`);
        console.log(`      日常价: ${change.from.daily} → ${change.to.daily}`);
        console.log(`      活动价: ${change.from.promo || '无'} → ${change.to.promo || '无'}`);
      });
      console.log('');
    });
  }

  // 4. 统计信息
  const stats = db.exec(`
    SELECT
      COUNT(DISTINCT package_name || '#' || refraction) as sku_count,
      COUNT(*) as total_records,
      MIN(record_time) as oldest,
      MAX(record_time) as newest
    FROM price_history
    WHERE record_time >= datetime('now', '-' || ? || ' days', 'localtime')
  `, [days]);

  if (stats.length > 0) {
    const [skuCount, totalRecords, oldest, newest] = stats[0].values[0];
    console.log('\n=== 统计信息 ===');
    console.log(`SKU 数量: ${skuCount}`);
    console.log(`总记录数: ${totalRecords}`);
    console.log(`时间范围: ${oldest} 至 ${newest}`);
  }

  db.close();
}

queryHistory().catch(console.error);
