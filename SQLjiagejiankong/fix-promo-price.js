const fs = require('fs');
const initSqlJs = require('sql.js');

async function fixDatabase() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync('./data/price_monitor.db');
  const db = new SQL.Database(buffer);

  db.run("UPDATE price_history SET promo_price = '' WHERE promo_price = '未知'");

  const result = db.exec("SELECT changes() as updated");
  const updated = result[0]?.values[0]?.[0] || 0;

  const data = db.export();
  fs.writeFileSync('./data/price_monitor.db', data);

  console.log(`已修复 ${updated} 条记录的 promo_price 字段`);
  db.close();
}

fixDatabase().catch(console.error);
