const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function checkEnvironment() {
  console.log('=== 第 1 步：确认当前环境 ===\n');

  // 1.1 数据库路径
  console.log('📁 1.1 数据库路径');
  console.log('---');
  const dbPath = path.resolve('./data/price_monitor.db');
  console.log('绝对路径:', dbPath);
  console.log('文件存在:', fs.existsSync(dbPath));

  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    console.log('文件大小:', (stats.size / 1024).toFixed(2), 'KB');
    console.log('最后修改:', stats.mtime.toISOString());
  }

  // 检查 WAL 文件
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  console.log('WAL 文件存在:', fs.existsSync(walPath));
  console.log('SHM 文件存在:', fs.existsSync(shmPath));

  if (!fs.existsSync(dbPath)) {
    console.log('\n❌ 数据库文件不存在，跳过后续检查');
    return;
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  // 1.2 时间戳检查
  console.log('\n⏰ 1.2 时间戳生成方式');
  console.log('---');

  const timeResult = db.exec('SELECT record_time FROM price_history_v2 ORDER BY record_time DESC LIMIT 1');
  if (timeResult.length > 0 && timeResult[0].values.length > 0) {
    const dbTime = timeResult[0].values[0][0];
    console.log('数据库最新时间:', dbTime);
    console.log('格式:', typeof dbTime === 'string' ? 'TEXT' : 'NUMBER');

    // 解析时间
    const parsedTime = new Date(dbTime);
    console.log('解析为 Date:', parsedTime.toISOString());
    console.log('转北京时间:', parsedTime.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}));

    // 当前时间对比
    const nowUTC = new Date().toISOString();
    const nowBeijing = new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'});
    console.log('\n当前 UTC 时间:', nowUTC);
    console.log('当前北京时间:', nowBeijing);

    // 判断数据库时间是 UTC 还是本地时间
    console.log('\n📊 分析:');
    if (dbTime.includes('T') && dbTime.includes('Z')) {
      console.log('✅ 数据库时间带 Z 后缀，明确是 UTC');
    } else if (dbTime.includes('T')) {
      console.log('⚠️  数据库时间带 T 但无时区标识，可能是 UTC 或本地时间');
    } else {
      console.log('⚠️  数据库时间格式: YYYY-MM-DD HH:MM:SS，无时区标识');
      console.log('    需要检查生成代码确认是 UTC 还是北京时间');
    }
  }

  // 1.3 价格精度检查
  console.log('\n💰 1.3 价格存储精度');
  console.log('---');

  const schemaResult = db.exec('SELECT sql FROM sqlite_master WHERE name="price_history_v2"');
  if (schemaResult.length > 0) {
    const schema = schemaResult[0].values[0][0];
    console.log('表结构:');
    console.log(schema);
  }

  console.log('\n实际价格样例:');
  const priceResult = db.exec('SELECT daily_price, promo_price FROM price_history_v2 LIMIT 5');
  if (priceResult.length > 0) {
    priceResult[0].values.forEach(([daily, promo], idx) => {
      console.log(`记录 ${idx + 1}:`);
      console.log('  daily_price:', daily, `(${typeof daily})`);
      console.log('  promo_price:', promo, `(${typeof promo})`);
    });
  }

  console.log('\n浮点精度测试:');
  const testResult = db.exec('SELECT 247.35 + 0.1 AS result');
  const result = testResult[0].values[0][0];
  console.log('247.35 + 0.1 =', result);
  console.log('预期: 247.45');
  console.log('误差:', Math.abs(result - 247.45) < 0.000001 ? '无' : '有');

  // 1.4 统计信息
  console.log('\n📊 1.4 数据统计');
  console.log('---');

  const skuCount = db.exec('SELECT COUNT(*) FROM products');
  console.log('SKU 总数:', skuCount[0].values[0][0]);

  const priceCount = db.exec('SELECT COUNT(*) FROM price_history_v2');
  console.log('价格记录数:', priceCount[0].values[0][0]);

  const batchCount = db.exec('SELECT COUNT(DISTINCT record_time) FROM price_history_v2');
  console.log('批次数量 (按 record_time):', batchCount[0].values[0][0]);

  const timeRange = db.exec('SELECT MIN(record_time), MAX(record_time) FROM price_history_v2');
  console.log('时间范围:', timeRange[0].values[0][0], '→', timeRange[0].values[0][1]);

  const nullPromo = db.exec('SELECT COUNT(*) FROM price_history_v2 WHERE promo_price IS NULL');
  console.log('无活动价记录数:', nullPromo[0].values[0][0]);

  // 1.5 批次分布
  console.log('\n📅 1.5 批次分布');
  console.log('---');
  const batches = db.exec(`
    SELECT record_time, COUNT(*) as count
    FROM price_history_v2
    GROUP BY record_time
    ORDER BY record_time DESC
    LIMIT 10
  `);
  if (batches.length > 0) {
    batches[0].values.forEach(([time, count]) => {
      console.log(`${time}: ${count} 条记录`);
    });
  }

  db.close();

  console.log('\n✅ 环境检查完成');
  console.log('\n📝 下一步: 请查看上述信息，确认:');
  console.log('   1. 时区判断是否正确');
  console.log('   2. 价格精度是否有问题');
  console.log('   3. 数据量和批次分布是否符合预期');
}

checkEnvironment().catch(err => {
  console.error('❌ 检查失败:', err.message);
  process.exit(1);
});
