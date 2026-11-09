const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/price_monitor_new.db');
const BACKUP_PATH = path.join(__dirname, '../data/price_monitor_new.db.backup');

async function runMigration() {
  // 检查数据库文件是否存在
  if (!fs.existsSync(DB_PATH)) {
    console.error(`错误: 数据库文件不存在: ${DB_PATH}`);
    process.exit(1);
  }

  // 检查数据库是否可写
  try {
    fs.accessSync(DB_PATH, fs.constants.W_OK);
  } catch (error) {
    console.error('错误: 数据库无写权限,请检查文件权限');
    process.exit(1);
  }

  // 创建备份
  try {
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    console.log(`✓ 已创建备份: ${BACKUP_PATH}`);
  } catch (error) {
    console.error(`警告: 无法创建备份: ${error.message}`);
  }

  let SQL;
  let db;

  try {
    SQL = await initSqlJs();
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);

    // 检查字段是否已存在
    const columns = db.exec("PRAGMA table_info(products)");
    if (columns.length === 0 || !columns[0].values) {
      throw new Error('无法读取 products 表结构');
    }

    const columnNames = columns[0].values.map(row => row[1]);
    const hasPageTitle = columnNames.includes('page_title');

    if (hasPageTitle) {
      console.log('✓ page_title 字段已存在,跳过创建');
      db.close();
      return;
    }

    // 添加 page_title 字段
    db.run('ALTER TABLE products ADD COLUMN page_title TEXT');

    console.log('✓ 已添加 page_title 字段');

    // 验证字段已添加
    const updatedColumns = db.exec("PRAGMA table_info(products)");
    const updatedColumnNames = updatedColumns[0].values.map(row => row[1]);
    const pageTitleIndex = updatedColumnNames.indexOf('page_title');

    if (pageTitleIndex !== -1) {
      const columnInfo = updatedColumns[0].values[pageTitleIndex];
      console.log(`  - 类型: ${columnInfo[2]}`);
      console.log(`  - 允许 NULL: ${columnInfo[3] === 0 ? '是' : '否'}`);
    } else {
      throw new Error('字段添加失败,验证未通过');
    }

    // 保存到磁盘
    const data = db.export();
    fs.writeFileSync(DB_PATH, data);
    console.log('✓ 数据库已保存');

    db.close();

  } catch (error) {
    if (db) {
      db.close();
    }

    console.error(`错误: 无法添加字段: ${error.message}`);
    console.error('可通过以下命令回滚:');
    console.error(`  cp ${BACKUP_PATH} ${DB_PATH}`);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  runMigration().catch(err => {
    console.error('迁移失败:', err);
    process.exit(1);
  });
}

module.exports = runMigration;
