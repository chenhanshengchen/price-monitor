const notifier = require('../src/notifier');

async function testDingTalkNotification() {
  console.log('=== 测试钉钉推送功能 ===\n');

  // 测试价格变动通知
  const testChanges = [
    {
      packageName: '防蓝光镜片',
      refraction: '1.56',
      oldDailyPrice: '128.00',
      newDailyPrice: '140.00',
      oldPromoPrice: '99.00',
      newPromoPrice: '99.00'
    }
  ];

  try {
    console.log('发送测试通知...');
    await notifier.notifyPriceChange(testChanges);
    console.log('✓ 测试通知发送成功\n');
  } catch (error) {
    console.error('✗ 测试通知发送失败:', error.message);
  }
}

testDingTalkNotification();
