const fs = require('fs');
const config = require('../config');
const logger = require('./logger');
const PriceDatabase = require('./database');
const notifier = require('./notifier');

class PriceMonitor {
  constructor() {
    this.db = new PriceDatabase();
  }

  readJSON() {
    if (!fs.existsSync(config.paths.input)) {
      throw new Error(`输入文件不存在: ${config.paths.input}`);
    }

    const content = fs.readFileSync(config.paths.input, 'utf8');
    const data = JSON.parse(content);

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('JSON数据格式错误或为空数组');
    }

    logger.info(`成功读取 ${data.length} 条商品数据`);
    return data;
  }

  parsePrice(priceStr) {
    if (!priceStr || priceStr === '未知') return null;
    const match = priceStr.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : null;
  }

  checkPriceChange(oldPrice, newPrice) {
    const oldVal = this.parsePrice(oldPrice);
    const newVal = this.parsePrice(newPrice);

    if (oldVal === null || newVal === null) return false;

    return Math.abs(newVal - oldVal) >= config.priceThreshold;
  }

  processData(data) {
    const changes = [];

    for (const item of data) {
      const packageName = item['镜片套餐'] || '';
      const refraction = item['折射率'] || '';
      const dailyPrice = item['日常价'] || '未知';
      const promoPrice = item['活动价'] || '未知';

      const latest = this.db.getLatestPrice(packageName, refraction);

      if (latest) {
        const dailyChanged = this.checkPriceChange(latest.daily_price, dailyPrice);
        const promoChanged = this.checkPriceChange(latest.promo_price, promoPrice);

        if (dailyChanged || promoChanged) {
          changes.push({
            packageName,
            refraction,
            oldDailyPrice: latest.daily_price,
            newDailyPrice: dailyPrice,
            oldPromoPrice: latest.promo_price,
            newPromoPrice: promoPrice
          });

          logger.info('检测到价格变动', {
            商品: `${packageName} | ${refraction}`,
            日常价: `${latest.daily_price} → ${dailyPrice}`,
            活动价: `${latest.promo_price} → ${promoPrice}`
          });
        }
      }

      this.db.insertPrice(packageName, refraction, dailyPrice, promoPrice);
    }

    return changes;
  }

  async run() {
    try {
      logger.info('=== 开始执行价格监控 ===');

      const data = this.readJSON();
      const changes = this.processData(data);

      if (changes.length > 0) {
        logger.info(`发现 ${changes.length} 个价格变动`);
        await notifier.notifyPriceChange(changes);
      } else {
        logger.info('无价格变动');
      }

      logger.info('=== 价格监控执行完成 ===');
      return changes;
    } catch (error) {
      logger.error('执行异常', { error: error.message, stack: error.stack });
      await notifier.notifyError(error.name, error.message);
      throw error;
    } finally {
      this.db.close();
    }
  }
}

module.exports = PriceMonitor;
