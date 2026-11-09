const fs = require('fs');
const config = require('../config');
const logger = require('./logger');
const PriceDatabase = require('./database');
const notifier = require('./notifier');

class PriceMonitor {
  constructor() {
    this.db = new PriceDatabase();
  }

  async init() {
    await this.db.init();
  }

  readJSON() {
    if (!fs.existsSync(config.paths.input)) {
      throw new Error(`输入文件不存在: ${config.paths.input}`);
    }

    const raw = fs.readFileSync(config.paths.input, 'utf8');

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`JSON 解析失败: ${e.message}`);
    }

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('JSON 数据格式错误或为空数组');
    }

    logger.info(`成功读取 ${data.length} 条商品数据`);
    return data;
  }

  // 将影刀输出的价格字符串转为 TEXT 格式
  // 返回 null 表示无活动价，否则返回数字字符串如 "247.35"
  normalizePrice(priceStr) {
    if (priceStr === null || priceStr === undefined) return null;
    if (typeof priceStr !== 'string') priceStr = String(priceStr);

    const trimmed = priceStr.trim();
    if (trimmed === '' || trimmed === '未知') return null;

    // 提取数字部分（去掉 ¥、元、空格等）
    const match = trimmed.match(/\d+(\.\d+)?/);
    if (!match) return null;

    const num = parseFloat(match[0]);
    if (isNaN(num) || num <= 0) return null;

    return String(num);
  }

  processData(productId, data) {
    if (!productId || typeof productId !== 'number' || productId < 1) {
      throw new Error('productId 参数必需且必须是正整数');
    }

    const sourceCount = data.length;

    // 修复 Bug：createBatch 之后若中途抛异常，批次会永远停在 'importing'
    // 使用 try/catch 确保批次一定会被标记为 success 或 failed
    const batchId = this.db.createBatch(productId, sourceCount);
    let insertedCount = 0;

    try {
      for (const item of data) {
        const packageName = item['镜片套餐'] || '';
        const refraction  = item['折射率']   || '';
        const dailyPrice  = item['日常价']   || '';
        const promoPrice  = item['活动价']   || '';

        if (!packageName) {
          logger.error('跳过无效数据行：缺少镜片套餐', { item });
          continue;
        }

        const normalizedDaily = this.normalizePrice(dailyPrice);
        const normalizedPromo = this.normalizePrice(promoPrice);
        const finalDaily = normalizedDaily !== null ? normalizedDaily : dailyPrice.trim();

        const skuId = this.db.findOrCreateSKU(productId, packageName, refraction);
        this.db.insertPriceSnapshot(batchId, skuId, finalDaily, normalizedPromo);
        insertedCount++;
      }

      this.db.completeBatch(batchId, insertedCount, true);
      logger.info(`批次 ${batchId} 写入完成，共 ${insertedCount} 条`);

    } catch (err) {
      // 写入过程中出错，将批次标记为 failed，不让它停在 importing
      logger.error(`批次 ${batchId} 写入失败`, { error: err.message });
      try {
        this.db.completeBatch(batchId, insertedCount, false, err.message);
      } catch (markErr) {
        logger.error(`批次 ${batchId} 标记为 failed 也失败了`, { error: markErr.message });
      }
      throw err;
    }

    const { current, previous } = this.db.getLatestTwoBatches(productId);
    const changes = this.db.getPriceChanges(productId, current, previous);

    if (!previous) {
      logger.info('无上一批次，跳过价格对比');
    }

    // 记录本次对比的两个批次，供推送消息使用
    this.lastComparison = { productId, current, previous };

    return changes;
  }

  // 导入后自动推送：本次批次与上一批次对比，涨跌超过网页上设置的阈值时推送
  // 推送失败只记录日志，不影响已经成功的导入
  async notifyChanges(changes) {
    if (changes.length === 0) {
      logger.info('无超阈值价格变动');
      return;
    }

    logger.info(`发现 ${changes.length} 个超阈值价格变动`);
    const { productId, current, previous } = this.lastComparison;
    try {
      const context = this.db.getPushContext(productId, current, previous);
      await notifier.notifyThresholdExceeded(context, changes, '抓取后自动推送');
    } catch (error) {
      logger.error('超阈值推送失败', { error: error.message });
    }
  }

  async run() {
    try {
      logger.info('=== 开始执行价格监控 ===');

      await this.init();

      const data = this.readJSON();

      // TODO: 步骤 4 将从 JSON 中提取 productId
      // 当前暂时硬编码为 1
      const productId = 1;

      const changes = this.processData(productId, data);

      await this.notifyChanges(changes);

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

  async runWithPayload(payload) {
    try {
      logger.info('=== 开始执行价格监控 ===');
      logger.info(`商品 ID: ${payload.itemId}`);
      logger.info(`商品标题: ${payload.title || '(无)'}`);
      logger.info(`SKU 数量: ${payload.skus.length}`);

      await this.init();

      // 注册或更新商品
      const productId = this.db.findOrCreateProduct(
        payload.itemId,
        payload.url,
        payload.title,
        payload.shopName,
        payload.articleNumber
      );

      // 写入价格数据
      const changes = this.processData(productId, payload.skus);

      await this.notifyChanges(changes);

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
