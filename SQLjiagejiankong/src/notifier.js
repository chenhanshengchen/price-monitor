const https = require('https');
const http = require('http');
const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');

// 单条消息最多列出的 SKU 数，避免超过钉钉消息长度限制，其余提示到网页查看
const MAX_ITEMS_PER_MESSAGE = 50;

class DingTalkNotifier {
  constructor() {
    this.webhook = config.dingtalk.webhook;
    this.secret = config.dingtalk.secret;
  }

  isConfigured() {
    return Boolean(this.webhook);
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

  // 发送消息；钉钉出错时 HTTP 状态码仍是 200，需要检查返回的 errcode
  sendMessage(content) {
    return new Promise((resolve, reject) => {
      if (!this.isConfigured()) {
        reject(new Error('未配置钉钉 Webhook，请在项目根目录 .env 中设置 DINGTALK_WEBHOOK'));
        return;
      }

      let url = this.webhook;
      if (this.secret) {
        const { timestamp, sign } = this.generateSign();
        url += `${url.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${sign}`;
      }

      const data = JSON.stringify({
        msgtype: 'text',
        text: { content }
      });

      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        timeout: 8000, // 小于网页服务 10 秒的请求超时，确保失败原因能返回给页面
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const transport = urlObj.protocol === 'http:' ? http : https;
      const req = transport.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let body = null;
          try {
            body = JSON.parse(responseData);
          } catch (_) {
            // 非 JSON 响应按失败处理
          }

          if (res.statusCode === 200 && body && body.errcode === 0) {
            logger.info('钉钉推送成功', { length: content.length });
            resolve(body);
          } else {
            const detail = body ? `${body.errcode} ${body.errmsg}` : `状态码 ${res.statusCode}`;
            const error = `钉钉推送失败: ${detail}`;
            logger.error(error, { response: responseData });
            reject(new Error(error));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('钉钉推送超时'));
      });

      req.on('error', (error) => {
        logger.error('钉钉推送异常', { error: error.message });
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  formatPrice(price) {
    return price === null || price === undefined ? '无活动价' : `¥${price}`;
  }

  // 生成超阈值推送内容：一个商品、一次对比汇总成一条消息
  buildThresholdMessage(context, changes, source) {
    const increased = changes.filter(c => c.changeType === 'increased').length;
    const decreased = changes.filter(c => c.changeType === 'decreased').length;

    // 按变动金额绝对值降序，与网页"超阈值"标签排序一致
    const sorted = changes.slice().sort(
      (a, b) => Math.abs(parseFloat(b.changeAmount)) - Math.abs(parseFloat(a.changeAmount))
    );
    const shown = sorted.slice(0, MAX_ITEMS_PER_MESSAGE);

    const lines = [
      `【价格超阈值提醒】（${source}）`,
      `商品：${context.productName}`,
      `店铺：${context.shopName || '-'}　货号：${context.articleNumber || '-'}`,
      `商品ID：${context.platformProductId}`,
      `对比：${context.previousBatchTime || '未知'} → ${context.currentBatchTime || '未知'}`,
      `阈值：¥${context.priceThreshold}（活动价涨跌超过该金额）`,
      `超阈值 SKU：${changes.length} 个（涨价 ${increased}，降价 ${decreased}）`,
      ''
    ];

    shown.forEach((c, i) => {
      const amount = parseFloat(c.changeAmount);
      const arrow = amount > 0 ? '↑' : '↓';
      lines.push(`${i + 1}. A：${c.packageName}`);
      lines.push(`   B：${c.refraction || '-'}`);
      lines.push(`   ${this.formatPrice(c.oldPromoPrice)} → ${this.formatPrice(c.newPromoPrice)}（${arrow} ¥${Math.abs(amount).toFixed(2)}）`);
    });

    if (sorted.length > shown.length) {
      lines.push('');
      lines.push(`另有 ${sorted.length - shown.length} 个 SKU 未列出，请在网页商品详情页查看`);
    }

    lines.push('');
    lines.push(`时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    return lines.join('\n');
  }

  // 推送超阈值 SKU；没有超阈值 SKU 时不发送。发送失败时抛出异常，由调用方决定如何处理
  async notifyThresholdExceeded(context, changes, source) {
    if (changes.length === 0) return false;
    await this.sendMessage(this.buildThresholdMessage(context, changes, source));
    return true;
  }

  // 推送执行异常通知
  async notifyError(errorType, errorMessage) {
    if (!this.isConfigured()) return;

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
}

module.exports = new DingTalkNotifier();
