const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== 开始测试价格监控系统 ===\n');

const testDirs = ['./data', './logs', './input'];
testDirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
console.log('✓ 清理测试环境\n');

const testData1 = [
  {
    "镜片套餐": "防蓝光镜片",
    "折射率": "1.56",
    "日常价": "128.00",
    "活动价": "99.00"
  },
  {
    "镜片套餐": "防蓝光镜片",
    "折射率": "1.60",
    "日常价": "158.00",
    "活动价": "119.00"
  },
  {
    "镜片套餐": "超薄镜片",
    "折射率": "1.67",
    "日常价": "258.00",
    "活动价": "199.00"
  }
];

fs.mkdirSync('./input', { recursive: true });
fs.writeFileSync('./input/current_price.json', JSON.stringify(testData1, null, 2));
console.log('✓ 创建测试数据\n');

console.log('--- 第一次运行（建立基线）---');
try {
  execSync('node index.js', { stdio: 'inherit' });
  console.log('✓ 第一次运行成功\n');
} catch (error) {
  console.error('✗ 第一次运行失败');
  process.exit(1);
}

const testData2 = [
  {
    "镜片套餐": "防蓝光镜片",
    "折射率": "1.56",
    "日常价": "140.00",
    "活动价": "99.00"
  },
  {
    "镜片套餐": "防蓝光镜片",
    "折射率": "1.60",
    "日常价": "158.00",
    "活动价": "105.00"
  },
  {
    "镜片套餐": "超薄镜片",
    "折射率": "1.67",
    "日常价": "258.00",
    "活动价": "199.00"
  }
];

fs.writeFileSync('./input/current_price.json', JSON.stringify(testData2, null, 2));
console.log('--- 第二次运行（检测价格变动）---');
console.log('修改数据: 防蓝光1.56日常价涨12元（超过阈值10元）\n');

try {
  execSync('node index.js', { stdio: 'inherit' });
  console.log('✓ 第二次运行成功\n');
} catch (error) {
  console.error('✗ 第二次运行失败');
  process.exit(1);
}

console.log('=== 验证结果 ===');
const checks = [
  { path: './data/price_monitor.db', name: '数据库文件' },
  { path: './logs', name: '日志目录' }
];

let allPassed = true;
checks.forEach(check => {
  if (fs.existsSync(check.path)) {
    console.log(`✓ ${check.name}已创建`);
  } else {
    console.log(`✗ ${check.name}未创建`);
    allPassed = false;
  }
});

if (allPassed) {
  console.log('\n=== 所有测试通过 ===');
} else {
  console.log('\n=== 部分测试失败 ===');
  process.exit(1);
}
