// 为 products 表增加店铺名 shop_name、货号 article_number 两列
// 只加列不改原有数据；列已存在则跳过，可重复运行
// 用法: node migrations/003_add_shop_article.js [--db <数据库路径>]
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { writeFileAtomic } = require('../src/fileUtils');

const NEW_COLUMNS = ['shop_name', 'article_number'];

function resolveDbPath() {
  const args = process.argv.slice(2);
  const dbIndex = args.indexOf('--db');
  return dbIndex !== -1 && args[dbIndex + 1]
    ? path.resolve(args[dbIndex + 1])
    : path.join(__dirname, '../data/price_monitor_new.db');
}

function timestamp() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function runMigration() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`数据库文件不存在: ${dbPath}`);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  try {
    const columns = db.exec('PRAGMA table_info(products)');
    if (columns.length === 0) {
      throw new Error('无法读取 products 表结构');
    }
    const existing = columns[0].values.map(row => row[1]);
    const missing = NEW_COLUMNS.filter(c => !existing.includes(c));

    if (missing.length === 0) {
      console.log('✓ shop_name、article_number 字段已存在，跳过');
      return;
    }

    // 先备份，再修改
    const backupPath = `${dbPath}.before_003_${timestamp()}`;
    fs.copyFileSync(dbPath, backupPath);
    console.log(`✓ 已备份: ${backupPath}`);

    for (const column of missing) {
      db.run(`ALTER TABLE products ADD COLUMN ${column} TEXT`);
      console.log(`✓ 已添加 ${column} 字段`);
    }

    const after = db.exec('PRAGMA table_info(products)')[0].values.map(row => row[1]);
    const stillMissing = NEW_COLUMNS.filter(c => !after.includes(c));
    if (stillMissing.length > 0) {
      throw new Error(`字段添加验证失败: ${stillMissing.join(', ')}`);
    }

    writeFileAtomic(dbPath, db.export());
    console.log('✓ 数据库已保存');
    console.log(`如需回滚: cp "${backupPath}" "${dbPath}"`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  runMigration().catch(err => {
    console.error('迁移失败:', err.message);
    process.exit(1);
  });
}

module.exports = runMigration;
