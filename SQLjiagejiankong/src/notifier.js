const https = require('https');
const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');

class DingTalkNotifier {
  constructor() {
    this.webhook = config.dingtalk.webhook;
    this.secret = config.dingtalk.secret;
  }

  // 生成签名
  generateSign() {
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${this.secret}`;
    const sign = crypto
      .createHmac('sha256', this.secret)
      .update(stringToSign)
      .digest('base64');

    return {
      timestamp,
      sign: encodeURIComponent(sign)
    };
  }

  // 发送消息
  sendMessage(content) {
    return new Promise((resolve, reject) => {
      const { timestamp, sign } = this.generateSign();
      const url = `${this.webhook}&timestamp=${timestamp}&sign=${sign}`;

      const data = JSON.stringify({
        msgtype: 'text',
        text: { content }
      });

      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            logger.info('钉钉推送成功', { content });
            resolve(responseData);
          } else {
            const error = `推送失败，状态码: ${res.statusCode}`;
            logger.error(error, { response: responseData });
            reject(new Error(error));
          }
        });
      });

      req.on('error', (error) => {
        logger.error('钉钉推送异常', { error: error.message });
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  // 推送价格变动通知
  async notifyPriceChange(changes) {
    if (changes.length === 0) return;

    const messages = changes.map(change => {
      const lines = [
        `【价格变动提醒】`,
        `商品：${change.packageName} | ${change.refraction}`,
        ``,
        `日常价：${change.oldDailyPrice} → ${change.newDailyPrice}`,
        `活动价：${change.oldPromoPrice} → ${change.newPromoPrice}`,
        ``,
        `时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
      ];
      return lines.join('\n');
    });

    for (const msg of messages) {
      try {
        await this.sendMessage(msg);
        await this.sleep(500);
      } catch (error) {
        logger.error('价格变动推送失败', { error: error.message });
      }
    }
  }

  // 推送执行异常通知
  async notifyError(errorType, errorMessage) {
    const msg = [
      `【监控系统异常】`,
      `错误类型：${errorType}`,
      `错误详情：${errorMessage}`,
      `时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
    ].join('\n');

    try {
      await this.sendMessage(msg);
    } catch (error) {
      logger.error('异常告警推送失败', { error: error.message });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new DingTalkNotifier();
