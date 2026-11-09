const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class PriceDatabase {
  constructor() {
    this.dbPath = path.resolve(config.paths.database);
    this.db = null;
    this.SQL = null;
  }

  async init() {
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.log('[Database] 数据库绝对路径:', this.dbPath);

    this.SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(buffer);
      console.log('[Database] 已加载现有数据库');
    } else {
      this.db = new this.SQL.Database();
      console.log('[Database] 创建新数据库');
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_name TEXT NOT NULL,
        refraction TEXT NOT NULL,
        daily_price TEXT NOT NULL,
        promo_price TEXT NOT NULL,
        record_time DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_package_refraction ON price_history(package_name, refraction)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_record_time ON price_history(record_time)`);

    const countResult = this.db.exec('SELECT COUNT(*) as total FROM price_history');
    const count = countResult[0] ? countResult[0].values[0][0] : 0;

    const latestResult = this.db.exec('SELECT MAX(record_time) as latest FROM price_history');
    const latest = latestResult[0] && latestResult[0].values[0][0] ? latestResult[0].values[0][0] : '无';

    console.log('[Database] 当前记录总数:', count);
    console.log('[Database] 最新记录时间:', latest);
  }

  getLatestPrice(packageName, refraction) {
    const result = this.db.exec(`
      SELECT daily_price, promo_price, record_time
      FROM price_history
      WHERE package_name = ? AND refraction = ?
      ORDER BY record_time DESC
      LIMIT 1
    `, [packageName, refraction]);

    if (result[0] && result[0].values.length > 0) {
      const row = result[0].values[0];
      return {
        daily_price: row[0],
        promo_price: row[1],
        record_time: row[2]
      };
    }
    return null;
  }

  insertPrice(packageName, refraction, dailyPrice, promoPrice) {
    this.db.run(`
      INSERT INTO price_history (package_name, refraction, daily_price, promo_price)
      VALUES (?, ?, ?, ?)
    `, [packageName, refraction, dailyPrice, promoPrice]);
  }

  save() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, data);
    console.log('[Database] 数据库已保存到磁盘');
  }

  close() {
    if (this.db) {
      this.save();
      this.db.close();
      console.log('[Database] 数据库连接已关闭');
    }
  }
}

module.exports = PriceDatabase;
