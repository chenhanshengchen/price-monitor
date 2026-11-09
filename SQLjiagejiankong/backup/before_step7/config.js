module.exports = {
  paths: {
    database: './data/price_monitor.db',
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
