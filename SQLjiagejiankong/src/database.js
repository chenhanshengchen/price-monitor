const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class PriceDatabase {
  constructor() {
    const dbDir = path.dirname(config.paths.database);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(config.paths.database);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_name TEXT NOT NULL,
        refraction TEXT NOT NULL,
        daily_price TEXT NOT NULL,
        promo_price TEXT NOT NULL,
        record_time DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_package_refraction
      ON price_history(package_name, refraction);

      CREATE INDEX IF NOT EXISTS idx_record_time
      ON price_history(record_time);
    `);
  }

  getLatestPrice(packageName, refraction) {
    const stmt = this.db.prepare(`
      SELECT daily_price, promo_price, record_time
      FROM price_history
      WHERE package_name = ? AND refraction = ?
      ORDER BY record_time DESC
      LIMIT 1
    `);
    return stmt.get(packageName, refraction);
  }

  insertPrice(packageName, refraction, dailyPrice, promoPrice) {
    const stmt = this.db.prepare(`
      INSERT INTO price_history (package_name, refraction, daily_price, promo_price)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(packageName, refraction, dailyPrice, promoPrice);
  }

  close() {
    this.db.close();
  }
}

module.exports = PriceDatabase;
