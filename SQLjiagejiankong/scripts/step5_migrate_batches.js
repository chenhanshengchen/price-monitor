const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function migrateBatchesAndPrices() {
  console.log('=== 第 5 步：迁移批次和价格数据 ===\n');

  const oldDbPath = path.resolve('./data/price_monitor.db');
  const newDbPath = path.resolve('./data/price_monitor_new.db');
  const mappingPath = path.resolve('./data/sku_id_mapping.json');

  // 加载 ID 映射
  const idMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  console.log(`📥 加载 SKU ID 映射: ${Object.keys(idMapping).length} 个映射\n`);

  // 打开数据库
  const SQL = await initSqlJs();
  const oldDb = new SQL.Database(fs.readFileSync(oldDbPath));
  const newDb = new SQL.Database(fs.readFileSync(newDbPath));
  newDb.run('PRAGMA foreign_keys = ON');

  // 1. 按 record_time 分组获取批次
  console.log('📅 分析旧库批次...');
  const batches = oldDb.exec(`
    SELECT
      record_time,
      COUNT(*) as count
    FROM price_history_v2
    GROUP BY record_time
    ORDER BY record_time
  `);

  if (batches.length === 0 || batches[0].values.length === 0) {
    console.log('❌ 旧库没有价格数据');
    return;
  }

  const batchList = batches[0].values;
  console.log(`找到 ${batchList.length} 个批次\n`);

  // 2. 创建批次记录
  console.log('📦 创建批次记录...');
  const insertBatch = newDb.prepare(`
    INSERT INTO collection_batches
    (product_id, imported_at, collected_at, status, completeness, source_record_count, inserted_record_count)
    VALUES (?, ?, NULL, 'success', 'unknown', ?, ?)
  `);

  const batchMapping = new Map(); // record_time -> batch_id

  for (const [recordTime, count] of batchList) {
    insertBatch.run([1, recordTime, count, count]);

    // 查询新批次 ID
    const batchIdResult = newDb.exec(
      'SELECT id FROM collection_batches WHERE imported_at = ?',
      [recordTime]
    );

    if (batchIdResult.length > 0 && batchIdResult[0].values.length > 0) {
      const batchId = batchIdResult[0].values[0][0];
      batchMapping.set(recordTime, batchId);
      console.log(`  批次 ${batchId}: ${recordTime} (${count} 条记录)`);
    }
  }

  insertBatch.free();
  console.log(`\n✅ 创建了 ${batchMapping.size} 个批次\n`);

  // 3. 迁移价格记录
  console.log('💰 迁移价格记录...');
  const priceData = oldDb.exec(`
    SELECT
      product_id,
      daily_price,
      promo_price,
      record_time
    FROM price_history_v2
    ORDER BY record_time, product_id
  `);

  if (priceData.length === 0 || priceData[0].values.length === 0) {
    console.log('❌ 没有价格数据');
    return;
  }

  const insertPrice = newDb.prepare(`
    INSERT INTO price_snapshots (batch_id, sku_id, daily_price, promo_price)
    VALUES (?, ?, ?, ?)
  `);

  let successCount = 0;
  let skippedCount = 0;
  let nullPromoCount = 0;

  for (const [oldProductId, dailyPrice, promoPrice, recordTime] of priceData[0].values) {
    // 查找新 SKU ID
    const newSkuId = idMapping[oldProductId];
    if (!newSkuId) {
      console.warn(`⚠️  找不到 SKU ID 映射: 旧 ID ${oldProductId}`);
      skippedCount++;
      continue;
    }

    // 查找批次 ID
    const batchId = batchMapping.get(recordTime);
    if (!batchId) {
      console.warn(`⚠️  找不到批次映射: ${recordTime}`);
      skippedCount++;
      continue;
    }

    // 价格转为文本（保留原始精度）
    const dailyPriceText = dailyPrice !== null ? String(dailyPrice) : '0';
    const promoPriceText = promoPrice !== null ? String(promoPrice) : null;

    if (promoPrice === null) {
      nullPromoCount++;
    }

    insertPrice.run([batchId, newSkuId, dailyPriceText, promoPriceText]);
    successCount++;
  }

  insertPrice.free();

  console.log(`✅ 迁移完成: ${successCount} 条成功, ${skippedCount} 条跳过`);
  console.log(`   其中 ${nullPromoCount} 条无活动价（NULL）\n`);

  // 4. 验证
  console.log('=== 验证 ===\n');

  const oldPriceCount = oldDb.exec('SELECT COUNT(*) FROM price_history_v2');
  const newPriceCount = newDb.exec('SELECT COUNT(*) FROM price_snapshots');
  console.log(`价格记录数: 旧库 ${oldPriceCount[0].values[0][0]}, 新库 ${newPriceCount[0].values[0][0]}`);

  if (oldPriceCount[0].values[0][0] === newPriceCount[0].values[0][0]) {
    console.log('✅ 价格记录数量一致');
  } else {
    console.log('⚠️  价格记录数量不一致');
  }

  const oldNullPromo = oldDb.exec('SELECT COUNT(*) FROM price_history_v2 WHERE promo_price IS NULL');
  const newNullPromo = newDb.exec('SELECT COUNT(*) FROM price_snapshots WHERE promo_price IS NULL');
  console.log(`\n无活动价记录: 旧库 ${oldNullPromo[0].values[0][0]}, 新库 ${newNullPromo[0].values[0][0]}`);

  if (oldNullPromo[0].values[0][0] === newNullPromo[0].values[0][0]) {
    console.log('✅ 无活动价记录数量一致');
  } else {
    console.log('⚠️  无活动价记录数量不一致');
  }

  // 检查价格格式
  console.log('\n价格格式样例（新库）:');
  const priceSample = newDb.exec(`
    SELECT daily_price, promo_price
    FROM price_snapshots
    LIMIT 5
  `);
  priceSample[0].values.forEach(([daily, promo], idx) => {
    console.log(`  记录 ${idx + 1}: daily="${daily}" (${typeof daily}), promo=${promo === null ? 'NULL' : '"' + promo + '"'} (${typeof promo})`);
  });

  // 批次统计
  console.log('\n批次统计（新库）:');
  const batchStats = newDb.exec(`
    SELECT
      cb.id,
      cb.imported_at,
      cb.status,
      cb.completeness,
      COUNT(ps.id) as price_count
    FROM collection_batches cb
    LEFT JOIN price_snapshots ps ON ps.batch_id = cb.id
    GROUP BY cb.id
    ORDER BY cb.imported_at DESC
  `);
  batchStats[0].values.forEach(([id, time, status, completeness, count]) => {
    console.log(`  批次 ${id}: ${time} [${status}/${completeness}] ${count} 条`);
  });

  // 保存
  fs.writeFileSync(newDbPath, newDb.export());

  oldDb.close();
  newDb.close();

  console.log('\n✅ 批次和价格迁移完成');
  console.log('\n📝 下一步: 运行 step6_verify_migration.js 全面验证迁移结果');
}

migrateBatchesAndPrices().catch(err => {
  console.error('❌ 迁移失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
