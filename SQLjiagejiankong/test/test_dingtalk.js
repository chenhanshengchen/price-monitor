// 手动测试：向 .env 中配置的钉钉群真实发送一条超阈值示例消息
// 运行: node test/test_dingtalk.js
const notifier = require('../src/notifier');

async function testDingTalkNotification() {
  console.log('=== 测试钉钉推送功能 ===\n');

  const context = {
    productName: '测试商品（请忽略）',
    platformProductId: '000000',
    priceThreshold: 5,
    previousBatchTime: '2026-01-01 09:00:00',
    currentBatchTime: '2026-01-01 18:00:00'
  };
  const testChanges = [
    {
      packageName: '防蓝光镜片',
      refraction: '1.56',
      oldPromoPrice: '99',
      newPromoPrice: '89',
      changeAmount: '-10.00',
      changeType: 'decreased'
    }
  ];

  try {
    console.log('发送测试通知...');
    await notifier.notifyThresholdExceeded(context, testChanges, '测试消息');
    console.log('✓ 测试通知发送成功\n');
  } catch (error) {
    console.error('✗ 测试通知发送失败:', error.message);
    process.exitCode = 1;
  }
}

testDingTalkNotification();
