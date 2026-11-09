const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function migrateSKUs() {
  console.log('=== 第 4 步：迁移 SKU 数据 ===\n');

  const oldDbPath = path.resolve('./data/price_monitor.db');
  const newDbPath = path.resolve('./data/price_monitor_new.db');

  // 打开两个数据库
  const SQL = await initSqlJs();
  const oldDb = new SQL.Database(fs.readFileSync(oldDbPath));
  const newDb = new SQL.Database(fs.readFileSync(newDbPath));
  newDb.run('PRAGMA foreign_keys = ON');

  // 1. 从旧库读取 SKU
  console.log('📥 从旧库读取 SKU...');
  const oldSKUs = oldDb.exec(`
    SELECT id, package_name, refraction
    FROM products
    ORDER BY id
  `);

  if (oldSKUs.length === 0 || oldSKUs[0].values.length === 0) {
    console.log('❌ 旧库没有 SKU 数据');
    return;
  }

  const skuCount = oldSKUs[0].values.length;
  console.log(`找到 ${skuCount} 个 SKU\n`);

  // 2. 统一空值规则并迁移
  console.log('📤 写入新库...');
  const insertSKU = newDb.prepare(`
    INSERT OR IGNORE INTO skus (product_id, package_name, refraction)
    VALUES (?, ?, ?)
  `);

  // 旧 ID → 新 ID 映射
  const idMapping = new Map();
  let migratedCount = 0;
  let skippedCount = 0;

  for (const [oldId, packageName, refraction] of oldSKUs[0].values) {
    // 统一空值规则：NULL → 空字符串
    const normalizedRefraction = refraction || '';

    insertSKU.run([1, packageName, normalizedRefraction]);

    // 查询新 ID
    const newIdResult = newDb.exec(
      'SELECT id FROM skus WHERE product_id = 1 AND package_name = ? AND refraction = ?',
      [packageName, normalizedRefraction]
    );

    if (newIdResult.length > 0 && newIdResult[0].values.length > 0) {
      const newId = newIdResult[0].values[0][0];
      idMapping.set(oldId, newId);
      migratedCount++;
    } else {
      skippedCount++;
    }
  }

  insertSKU.free();

  console.log(`✅ 迁移完成: ${migratedCount} 个成功, ${skippedCount} 个跳过\n`);

  // 3. 验证
  console.log('=== 验证 ===\n');

  const newSkuCount = newDb.exec('SELECT COUNT(*) FROM skus');
  console.log(`新库 SKU 总数: ${newSkuCount[0].values[0][0]}`);
  console.log(`旧库 SKU 总数: ${skuCount}`);

  if (newSkuCount[0].values[0][0] === skuCount) {
    console.log('✅ SKU 数量一致');
  } else {
    console.log('⚠️  SKU 数量不一致');
  }

  // 检查空折射率统一情况
  const emptyRefractionOld = oldDb.exec("SELECT COUNT(*) FROM products WHERE refraction IS NULL OR refraction = ''");
  const emptyRefractionNew = newDb.exec("SELECT COUNT(*) FROM skus WHERE refraction = ''");
  console.log(`\n空折射率 SKU: 旧库 ${emptyRefractionOld[0].values[0][0]} 个, 新库 ${emptyRefractionNew[0].values[0][0]} 个`);

  if (emptyRefractionOld[0].values[0][0] === emptyRefractionNew[0].values[0][0]) {
    console.log('✅ 空折射率数量一致');
  } else {
    console.log('⚠️  空折射率数量不一致');
  }

  // 4. 保存映射表到文件（供后续步骤使用）
  const mappingPath = path.resolve('./data/sku_id_mapping.json');
  const mappingObj = Object.fromEntries(idMapping);
  fs.writeFileSync(mappingPath, JSON.stringify(mappingObj, null, 2));
  console.log(`\n💾 ID 映射已保存: ${mappingPath}`);

  // 5. 显示映射样例
  console.log('\n映射样例（前 5 个）:');
  let count = 0;
  for (const [oldId, newId] of idMapping) {
    if (count >= 5) break;
    console.log(`  旧 ID ${oldId} → 新 ID ${newId}`);
    count++;
  }

  // 保存新数据库
  fs.writeFileSync(newDbPath, newDb.export());

  oldDb.close();
  newDb.close();

  console.log('\n✅ SKU 迁移完成');
  console.log('\n📝 下一步: 运行 step5_migrate_batches.js 迁移批次和价格');
}

migrateSKUs().catch(err => {
  console.error('❌ 迁移失败:', err.message);
  process.exit(1);
});
