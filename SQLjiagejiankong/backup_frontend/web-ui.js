const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;
const RETENTION_DAYS = config.dataRetentionDays || 3;
const PRICE_CHANGE_THRESHOLD = config.priceChangeThreshold || 0;

let productConfig;
try {
  productConfig = require('./product-config.json');
} catch (e) {
  console.warn('Warning: product-config.json not found, using defaults');
  productConfig = {
    product_url: 'unknown',
    product_id: 'unknown',
    brand: 'unknown'
  };
}

let db;

async function initDatabase() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(config.paths.database);
  db = new SQL.Database(buffer);
}

function runQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getOne(sql, params = []) {
  const results = runQuery(sql, params);
  return results.length > 0 ? results[0] : null;
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  try {
    const result = getOne('SELECT COUNT(*) as count FROM price_history');
    res.json({
      status: 'ok',
      database: 'connected',
      records: result.count
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/api/query-times', (req, res) => {
  console.log('[API] GET /api/query-times start', { date: req.query.date });
  try {
    const dateParam = req.query.date;

    const latestRecord = getOne('SELECT MAX(record_time) as latest FROM price_history');
    if (!latestRecord || !latestRecord.latest) {
      console.log('[API] GET /api/query-times no data');
      return res.json([]);
    }

    const cutoffTime = latestRecord.latest;

    let query;
    let params = [];

    if (dateParam) {
      query = `
        SELECT DISTINCT record_time
        FROM price_history
        WHERE DATE(record_time) = ?
        AND record_time >= datetime(?, '-' || ? || ' days')
        ORDER BY record_time DESC
      `;
      params = [dateParam, cutoffTime, RETENTION_DAYS];
    } else {
      query = `
        SELECT DATE(record_time) as date, MAX(record_time) as latest_time
        FROM price_history
        WHERE record_time >= datetime(?, '-' || ? || ' days')
        GROUP BY DATE(record_time)
        ORDER BY date DESC
      `;
      params = [cutoffTime, RETENTION_DAYS];
    }

    const results = runQuery(query, params);
    console.log('[API] GET /api/query-times success', { count: results.length });
    res.json(results);
  } catch (error) {
    console.error('[API] GET /api/query-times error', error);
    res.status(500).json({
      error: 'DATABASE_ERROR',
      message: error.message
    });
  }
});

app.get('/api/products', (req, res) => {
  console.log('[API] GET /api/products start', { date: req.query.date, record_time: req.query.record_time });
  try {
    const dateParam = req.query.date;
    const recordTimeParam = req.query.record_time;

    const latestRecord = getOne('SELECT MAX(record_time) as latest FROM price_history');
    if (!latestRecord || !latestRecord.latest) {
      console.log('[API] GET /api/products no data in database');
      return res.json({
        product_url: productConfig.product_url,
        product_id: productConfig.product_id,
        brand: productConfig.brand,
        query_time: null,
        sku_count: 0,
        skus: []
      });
    }

    const cutoffTime = latestRecord.latest;

    let targetTime;

    if (recordTimeParam) {
      targetTime = recordTimeParam;
    } else if (dateParam) {
      const maxTime = getOne(
        `SELECT MAX(record_time) as max_time
         FROM price_history
         WHERE DATE(record_time) = ?
         AND record_time >= datetime(?, '-' || ? || ' days')`,
        [dateParam, cutoffTime, RETENTION_DAYS]
      );
      targetTime = maxTime ? maxTime.max_time : null;
    } else {
      const latestDateMax = getOne(
        `SELECT MAX(record_time) as max_time
         FROM price_history
         WHERE record_time >= datetime(?, '-' || ? || ' days')`,
        [cutoffTime, RETENTION_DAYS]
      );
      targetTime = latestDateMax ? latestDateMax.max_time : null;
    }

    if (!targetTime) {
      return res.json({
        product_url: productConfig.product_url,
        product_id: productConfig.product_id,
        brand: productConfig.brand,
        query_time: null,
        sku_count: 0,
        skus: []
      });
    }

    const skus = runQuery(`
      SELECT
        package_name,
        refraction,
        daily_price,
        promo_price,
        record_time
      FROM price_history
      WHERE record_time = ?
      ORDER BY package_name, refraction
    `, [targetTime]).map(sku => ({
      sku_key: Buffer.from(`${sku.package_name}#${sku.refraction}`).toString('base64'),
      package_name: sku.package_name,
      refraction: sku.refraction || '',
      daily_price: sku.daily_price,
      promo_price: sku.promo_price === '' ? null : sku.promo_price,
      record_time: sku.record_time
    }));

    console.log('[API] GET /api/products success', { query_time: targetTime, sku_count: skus.length });
    res.json({
      product_url: productConfig.product_url,
      product_id: productConfig.product_id,
      brand: productConfig.brand,
      query_time: targetTime,
      sku_count: skus.length,
      skus: skus
    });
  } catch (error) {
    console.error('[API] GET /api/products error', error);
    res.status(500).json({
      error: 'DATABASE_ERROR',
      message: error.message
    });
  }
});

app.get('/api/skus/:sku_key/history', (req, res) => {
  try {
    const { sku_key } = req.params;
    const daysParam = req.query.days;
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    if (!daysParam || isNaN(days) || days < 1 || days > 365) {
      return res.status(400).json({
        error: 'INVALID_PARAMETER',
        message: 'days must be an integer between 1 and 365'
      });
    }

    let decoded;
    try {
      decoded = Buffer.from(sku_key, 'base64').toString('utf-8');
    } catch (e) {
      return res.status(400).json({
        error: 'INVALID_SKU_KEY',
        message: 'Invalid sku_key format'
      });
    }

    const parts = decoded.split('#');
    if (parts.length !== 2) {
      return res.status(400).json({
        error: 'INVALID_SKU_KEY',
        message: 'Invalid sku_key format'
      });
    }

    const [package_name, refraction] = parts;

    const history = runQuery(`
      SELECT
        DATE(record_time) as date,
        daily_price,
        promo_price
      FROM price_history
      WHERE package_name = ?
        AND refraction = ?
        AND record_time >= datetime('now', '-' || ? || ' days')
      ORDER BY record_time ASC
    `, [package_name, refraction, days]).map(row => ({
      date: row.date,
      daily_price: row.daily_price,
      promo_price: row.promo_price === '' ? null : row.promo_price
    }));

    res.json(history);
  } catch (error) {
    res.status(500).json({
      error: 'DATABASE_ERROR',
      message: error.message
    });
  }
});

app.get('/api/comparison', (req, res) => {
  console.log('[API] GET /api/comparison start', { date: req.query.date, record_time: req.query.record_time });
  try {
    const dateParam = req.query.date;
    const recordTimeParam = req.query.record_time;

    const latestRecord = getOne('SELECT MAX(record_time) as latest FROM price_history');
    if (!latestRecord || !latestRecord.latest) {
      console.log('[API] GET /api/comparison no data');
      return res.json({
        current_time: null,
        previous_time: null,
        threshold: PRICE_CHANGE_THRESHOLD,
        items: []
      });
    }

    const cutoffTime = latestRecord.latest;

    let currentTime;

    if (recordTimeParam) {
      currentTime = recordTimeParam;
    } else if (dateParam) {
      const maxTime = getOne(
        `SELECT MAX(record_time) as max_time
         FROM price_history
         WHERE DATE(record_time) = ?
         AND record_time >= datetime(?, '-' || ? || ' days')`,
        [dateParam, cutoffTime, RETENTION_DAYS]
      );
      currentTime = maxTime ? maxTime.max_time : null;
    } else {
      const latestDateMax = getOne(
        `SELECT MAX(record_time) as max_time
         FROM price_history
         WHERE record_time >= datetime(?, '-' || ? || ' days')`,
        [cutoffTime, RETENTION_DAYS]
      );
      currentTime = latestDateMax ? latestDateMax.max_time : null;
    }

    if (!currentTime) {
      return res.json({
        current_time: null,
        previous_time: null,
        threshold: PRICE_CHANGE_THRESHOLD,
        items: []
      });
    }

    const previousTime = getOne(
      `SELECT MAX(record_time) as prev_time
       FROM price_history
       WHERE record_time < ?
       AND record_time >= datetime(?, '-' || ? || ' days')`,
      [currentTime, cutoffTime, RETENTION_DAYS]
    );

    const prevTime = previousTime ? previousTime.prev_time : null;

    if (!prevTime) {
      return res.json({
        current_time: currentTime,
        previous_time: null,
        threshold: PRICE_CHANGE_THRESHOLD,
        items: []
      });
    }

    const currentData = runQuery(
      `SELECT package_name, refraction, promo_price
       FROM price_history
       WHERE record_time = ?`,
      [currentTime]
    );

    const previousData = runQuery(
      `SELECT package_name, refraction, promo_price
       FROM price_history
       WHERE record_time = ?`,
      [prevTime]
    );

    const prevMap = {};
    previousData.forEach(row => {
      const key = `${row.package_name}#${row.refraction}`;
      prevMap[key] = row.promo_price === '' ? null : parseFloat(row.promo_price);
    });

    const items = [];

    currentData.forEach(curr => {
      const key = `${curr.package_name}#${curr.refraction}`;
      const currentPromo = curr.promo_price === '' ? null : parseFloat(curr.promo_price);
      const previousPromo = prevMap[key];

      let changeType = 'unchanged';
      let changeValue = null;
      let changePercent = null;

      if (previousPromo === undefined) {
        changeType = 'new_sku';
      } else if (previousPromo === null && currentPromo !== null) {
        changeType = 'new_promo';
      } else if (previousPromo !== null && currentPromo === null) {
        changeType = 'promo_removed';
      } else if (previousPromo !== null && currentPromo !== null) {
        changeValue = currentPromo - previousPromo;

        if (Math.abs(changeValue) > PRICE_CHANGE_THRESHOLD) {
          changeType = changeValue > 0 ? 'increased' : 'decreased';
          changePercent = previousPromo !== 0 ? (changeValue / previousPromo * 100) : null;
        }
      }

      if (changeType === 'increased' || changeType === 'decreased') {
        items.push({
          sku_key: Buffer.from(key).toString('base64'),
          package_name: curr.package_name,
          refraction: curr.refraction,
          previous_promo_price: previousPromo,
          current_promo_price: currentPromo,
          change_value: changeValue,
          change_percent: changePercent,
          change_type: changeType
        });
      }
    });

    console.log('[API] GET /api/comparison success', { current_time: currentTime, previous_time: prevTime, items_count: items.length });
    res.json({
      current_time: currentTime,
      previous_time: prevTime,
      threshold: PRICE_CHANGE_THRESHOLD,
      items: items
    });
  } catch (error) {
    console.error('[API] GET /api/comparison error', error);
    res.status(500).json({
      error: 'DATABASE_ERROR',
      message: error.message
    });
  }
});

app.get('/api/stats', (req, res) => {
  console.log('[API] GET /api/stats start');
  try {
    const latestRecord = getOne('SELECT MAX(record_time) as latest FROM price_history');
    if (!latestRecord || !latestRecord.latest) {
      console.log('[API] GET /api/stats no data');
      return res.json({
        product_count: 1,
        sku_count: 0,
        last_update: null,
        retention_days: RETENTION_DAYS,
        price_change_threshold: PRICE_CHANGE_THRESHOLD
      });
    }

    const cutoffTime = latestRecord.latest;

    const skuCount = getOne(`
      SELECT COUNT(DISTINCT (package_name || '#' || refraction)) as count
      FROM price_history
      WHERE record_time >= datetime(?, '-' || ? || ' days')
    `, [cutoffTime, RETENTION_DAYS]);

    const latestTime = getOne(`
      SELECT MAX(record_time) as latest
      FROM price_history
      WHERE record_time >= datetime(?, '-' || ? || ' days')
    `, [cutoffTime, RETENTION_DAYS]);

    console.log('[API] GET /api/stats success', { sku_count: skuCount.count, last_update: latestTime.latest });
    res.json({
      product_count: 1,
      sku_count: skuCount.count,
      last_update: latestTime.latest,
      retention_days: RETENTION_DAYS,
      price_change_threshold: PRICE_CHANGE_THRESHOLD
    });
  } catch (error) {
    console.error('[API] GET /api/stats error', error);
    res.status(500).json({
      error: 'DATABASE_ERROR',
      message: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'Endpoint not found'
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'SERVER_ERROR',
    message: 'Internal server error'
  });
});

initDatabase().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Price Monitor Web UI running at http://localhost:${PORT}`);
    console.log(`Database: ${config.paths.database}`);
    console.log(`Product: ${productConfig.brand} (${productConfig.product_id})`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
      if (db) db.close();
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    server.close(() => {
      if (db) db.close();
      process.exit(0);
    });
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});
