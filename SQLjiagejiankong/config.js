const fs = require('fs');
const path = require('path');

// 读取项目根目录的 .env（KEY=VALUE 每行一个），已存在的环境变量优先
// .env 保存钉钉密钥等敏感信息，已加入 .gitignore，不提交到仓库
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnvFile(path.join(__dirname, '.env'));

module.exports = {
  paths: {
    database: './data/price_monitor_new.db',
    input: '/mnt/c/temp/current_price.json',
    logs: './logs'
  },
  priceThreshold: 5,
  dingtalk: {
    webhook: process.env.DINGTALK_WEBHOOK || '',
    secret: process.env.DINGTALK_SECRET || ''
  },
  dataRetentionDays: 3,
  priceChangeThreshold: 0,
  timezone: 'Asia/Shanghai'
};
