const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function verifyMigration() {
  console.log('=== 第 6 步：全面验证迁移结果 ===\n');

  const oldDbPath = path.resolve('./data/price_monitor.db');
  const newDbPath = path.resolve('./data/price_monitor_new.db');

  const SQL = await initSqlJs();
  const oldDb = new SQL.Database(fs.readFileSync(oldDbPath));
  const newDb = new SQL.Database(fs.readFileSync(newDbPath));
  newDb.run('PRAGMA foreign_keys = ON');

  let allPassed = true;
  const results = [];

  function check(name, condition, detail) {
    const status = condition ? '✅' : '❌';
    results.push({ name, condition, detail });
    console.log(`${status} ${name}`);
    if (detail) console.log(`   ${detail}`);
    if (!condition) allPassed = false;
  }

  // ===== 1. 表结构验证 =====
  console.log('📋 1. 表结构验证\n');

  const tables = newDb.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const tableNames = tables[0].values.map(([n]) => n);

  check('商品表 products 存在', tableNames.includes('products'));
  check('SKU 表 skus 存在', tableNames.includes('skus'));
  check('批次表 collection_batches 存在', tableNames.includes('collection_batches'));
  check('价格快照表 price_snapshots 存在', tableNames.includes('price_snapshots'));

  // ===== 2. 数据量验证 =====
  console.log('\n📊 2. 数据量验证\n');

  const oldSkuCount = oldDb.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
  const newSkuCount = newDb.exec('SELECT COUNT(*) FROM skus')[0].values[0][0];
  check('SKU 数量一致', oldSkuCount === newSkuCount, `旧库 ${oldSkuCount}, 新库 ${newSkuCount}`);

  const oldPriceCount = oldDb.exec('SELECT COUNT(*) FROM price_history_v2')[0].values[0][0];
  const newPriceCount = newDb.exec('SELECT COUNT(*) FROM price_snapshots')[0].values[0][0];
  check('价格记录数一致', oldPriceCount === newPriceCount, `旧库 ${oldPriceCount}, 新库 ${newPriceCount}`);

  const oldBatchCount = oldDb.exec('SELECT COUNT(DISTINCT record_time) FROM price_history_v2')[0].values[0][0];
  const newBatchCount = newDb.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
  check('批次数量一致', oldBatchCount === newBatchCount, `旧库 ${oldBatchCount}, 新库 ${newBatchCount}`);

  // ===== 3. NULL 处理验证 =====
  console.log('\n🔍 3. NULL 活动价处理验证\n');

  const oldNullPromo = oldDb.exec('SELECT COUNT(*) FROM price_history_v2 WHERE promo_price IS NULL')[0].values[0][0];
  const newNullPromo = newDb.exec('SELECT COUNT(*) FROM price_snapshots WHERE promo_price IS NULL')[0].values[0][0];
  check('无活动价记录一致', oldNullPromo === newNullPromo, `旧库 ${oldNullPromo}, 新库 ${newNullPromo}`);

  // ===== 4. 价格精度验证 =====
  console.log('\n💰 4. 价格精度验证\n');

  // 抽查 10 条价格记录，确保数值正确
  const oldPrices = oldDb.exec(`
    SELECT product_id, daily_price, promo_price, record_time
    FROM price_history_v2
    ORDER BY id
    LIMIT 10
  `)[0].values;

  const mapping = JSON.parse(fs.readFileSync('./data/sku_id_mapping.json', 'utf8'));

  let priceAccuracyPassed = true;
  let checkedCount = 0;

  for (const [oldSkuId, oldDaily, oldPromo, recordTime] of oldPrices) {
    const newSkuId = mapping[oldSkuId];
    if (!newSkuId) {
      priceAccuracyPassed = false;
      console.log(`   ⚠️  找不到 SKU 映射: 旧 ID ${oldSkuId}`);
      continue;
    }

    const newPrice = newDb.exec(
      `SELECT daily_price, promo_price FROM price_snapshots ps
       JOIN collection_batches cb ON ps.batch_id = cb.id
       WHERE ps.sku_id = ? AND cb.imported_at = ?`,
      [newSkuId, recordTime]
    );

    if (newPrice.length === 0 || newPrice[0].values.length === 0) {
      priceAccuracyPassed = false;
      console.log(`   ⚠️  新库找不到对应记录: SKU ${newSkuId}, 时间 ${recordTime}`);
      continue;
    }

    const [newDaily, newPromo] = newPrice[0].values[0];

    // 比较数值（将新库 TEXT 转为数字比较）
    const oldDailyNum = parseFloat(oldDaily);
    const newDailyNum = parseFloat(newDaily);

    if (Math.abs(oldDailyNum - newDailyNum) > 0.000001) {
      priceAccuracyPassed = false;
      console.log(`   ⚠️  日常价不匹配: 旧 ${oldDaily} → 新 ${newDaily}`);
    }

    if (oldPromo === null && newPromo !== null) {
      priceAccuracyPassed = false;
      console.log(`   ⚠️  活动价应为 NULL 但变为 ${newPromo}`);
    } else if (oldPromo !== null && newPromo === null) {
      priceAccuracyPassed = false;
      console.log(`   ⚠️  活动价应为 ${oldPromo} 但变为 NULL`);
    } else if (oldPromo !== null && newPromo !== null) {
      if (Math.abs(parseFloat(oldPromo) - parseFloat(newPromo)) > 0.000001) {
        priceAccuracyPassed = false;
        console.log(`   ⚠️  活动价不匹配: 旧 ${oldPromo} → 新 ${newPromo}`);
      }
    }

    checkedCount++;
  }

  check(`抽查 ${checkedCount} 条价格记录数值正确`, priceAccuracyPassed);

  // ===== 5. 归属关系验证 =====
  console.log('\n🔗 5. 归属关系验证\n');

  // 所有 SKU 必须归属商品 1
  const skusWithoutProduct = newDb.exec('SELECT COUNT(*) FROM skus WHERE product_id IS NULL OR product_id != 1')[0].values[0][0];
  check('所有 SKU 归属商品 1', skusWithoutProduct === 0, `异常 SKU 数: ${skusWithoutProduct}`);

  // 所有批次必须归属商品 1
  const batchesWithoutProduct = newDb.exec('SELECT COUNT(*) FROM collection_batches WHERE product_id IS NULL OR product_id != 1')[0].values[0][0];
  check('所有批次归属商品 1', batchesWithoutProduct === 0, `异常批次数: ${batchesWithoutProduct}`);

  // 所有价格快照必须关联到有效批次和 SKU
  const orphanSnapshots = newDb.exec(`
    SELECT COUNT(*) FROM price_snapshots ps
    WHERE ps.batch_id NOT IN (SELECT id FROM collection_batches)
       OR ps.sku_id NOT IN (SELECT id FROM skus)
  `)[0].values[0][0];
  check('无孤儿价格记录', orphanSnapshots === 0, `孤儿记录数: ${orphanSnapshots}`);

  // ===== 6. 唯一约束验证 =====
  console.log('\n🔒 6. 唯一约束验证\n');

  // 检查 SKU 唯一性
  const duplicateSkus = newDb.exec(`
    SELECT product_id, package_name, refraction, COUNT(*) as cnt
    FROM skus
    GROUP BY product_id, package_name, refraction
    HAVING cnt > 1
  `);
  check('SKU 无重复', duplicateSkus.length === 0);

  // 检查价格快照唯一性
  const duplicateSnapshots = newDb.exec(`
    SELECT batch_id, sku_id, COUNT(*) as cnt
    FROM price_snapshots
    GROUP BY batch_id, sku_id
    HAVING cnt > 1
  `);
  check('价格快照无重复', duplicateSnapshots.length === 0);

  // ===== 7. 外键完整性验证 =====
  console.log('\n🔑 7. 外键完整性验证\n');

  const fkCheck = newDb.exec('PRAGMA foreign_key_check');
  check('外键完整性检查通过', fkCheck.length === 0,
    fkCheck.length > 0 ? `发现 ${fkCheck[0].values.length} 个外键违规` : null);

  // ===== 8. 价格格式验证 =====
  console.log('\n📝 8. 价格格式验证\n');

  const priceTypes = newDb.exec(`
    SELECT typeof(daily_price), typeof(promo_price)
    FROM price_snapshots
    LIMIT 1
  `);
  if (priceTypes.length > 0) {
    const [dailyType, promoType] = priceTypes[0].values[0];
    check('daily_price 使用 TEXT 类型', dailyType === 'text', `实际类型: ${dailyType}`);
    check('promo_price 为 NULL 或 TEXT', promoType === 'text' || promoType === 'null', `实际类型: ${promoType}`);
  }

  // 检查没有空字符串活动价（应该是 NULL 而不是空字符串）
  const emptyStringPromo = newDb.exec("SELECT COUNT(*) FROM price_snapshots WHERE promo_price = ''")[0].values[0][0];
  check('无空字符串活动价', emptyStringPromo === 0, `空字符串记录数: ${emptyStringPromo}`);

  // ===== 9. 批次完整性标记验证 =====
  console.log('\n📅 9. 批次完整性标记验证\n');

  const unknownBatches = newDb.exec("SELECT COUNT(*) FROM collection_batches WHERE completeness = 'unknown'")[0].values[0][0];
  const totalBatches = newDb.exec('SELECT COUNT(*) FROM collection_batches')[0].values[0][0];
  check('所有批次标记为 unknown', unknownBatches === totalBatches, `${unknownBatches}/${totalBatches}`);

  const successBatches = newDb.exec("SELECT COUNT(*) FROM collection_batches WHERE status = 'success'")[0].values[0][0];
  check('所有批次标记为 success 导入', successBatches === totalBatches, `${successBatches}/${totalBatches}`);

  // ===== 10. 旧库未修改验证 =====
  console.log('\n🛡️ 10. 旧库未修改验证\n');

  const oldFileStats = fs.statSync(oldDbPath);
  const oldMtime = oldFileStats.mtime.toISOString();
  console.log(`   旧库最后修改时间: ${oldMtime}`);

  // 检查旧库数据量未变
  const oldSkuStill = oldDb.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
  const oldPriceStill = oldDb.exec('SELECT COUNT(*) FROM price_history_v2')[0].values[0][0];
  check('旧库 SKU 数量未变', oldSkuStill === 83, `当前: ${oldSkuStill}`);
  check('旧库价格记录数量未变', oldPriceStill === 287, `当前: ${oldPriceStill}`);

  // ===== 汇总报告 =====
  console.log('\n' + '='.repeat(60));
  console.log('📋 验证汇总报告');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.condition).length;
  const failed = results.filter(r => !r.condition).length;

  console.log(`\n总计: ${results.length} 项检查`);
  console.log(`通过: ${passed} 项`);
  console.log(`失败: ${failed} 项`);

  if (allPassed) {
    console.log('\n🎉 所有验证通过！迁移成功！');
    console.log('\n📝 下一步:');
    console.log('   - 数据库已准备好切换');
    console.log('   - 旧库保持完整，可随时回退');
  } else {
    console.log('\n⚠️  部分验证失败，请检查上述错误');
    console.log('\n📝 建议:');
    console.log('   - 修复失败项后重新运行验证');
    console.log('   - 旧库未受影响，可安全重试');
  }

  console.log('\n📊 新数据库统计:');
  console.log(`   - 商品: ${newDb.exec('SELECT COUNT(*) FROM products')[0].values[0][0]}`);
  console.log(`   - SKU: ${newSkuCount}`);
  console.log(`   - 批次: ${newBatchCount}`);
  console.log(`   - 价格记录: ${newPriceCount}`);

  oldDb.close();
  newDb.close();
}

verifyMigration().catch(err => {
  console.error('❌ 验证脚本失败:', err.message);
  process.exit(1);
});
