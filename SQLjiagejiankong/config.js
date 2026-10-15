module.exports = {
  paths: {
    database: './data/price_monitor.db',
    input: './input/current_price.json',
    logs: './logs'
  },
  priceThreshold: 5,

  dingtalk: {
    webhook: 'https://oapi.dingtalk.com/robot/send?access_token=9c930eca6efa225761c4490aa754e2eeb0792b23d337ae662dbfdb9acc2fd46c',
    secret: 'SEC1f883043d7c3f2d769494ebb1e4f3d6c6d255901c4e74fcb74222d6cc1538281'
  }
};
