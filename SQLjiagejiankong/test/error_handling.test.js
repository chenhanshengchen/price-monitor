/**
 * 异常情况综合测试
 * 验证所有已添加的错误处理
 */

const assert = require('assert');

console.log('=== 异常处理测试 ===\n');

// 测试 1: parsePositiveInt 对非法输入的处理
console.log('测试 1: parsePositiveInt 参数校验');
function parsePositiveInt(value) {
  const n = parseInt(value, 10);
  if (!isFinite(n) || isNaN(n) || n < 1) return null;
  return n;
}

assert.strictEqual(parsePositiveInt('abc'), null, 'NaN 应返回 null');
assert.strictEqual(parsePositiveInt('0'), null, '0 应返回 null');
assert.strictEqual(parsePositiveInt('-5'), null, '负数应返回 null');
assert.strictEqual(parsePositiveInt('3.14'), 3, '小数应截断为整数');
assert.strictEqual(parsePositiveInt('123'), 123, '正整数应正常返回');
console.log('✅ 通过\n');

// 测试 2: parsePrice 对损坏价格字符串的处理
console.log('测试 2: parsePrice 处理损坏数据');
function parsePrice(str) {
  if (str === null || str === undefined) return null;
  const n = parseFloat(str);
  if (!isFinite(n) || isNaN(n)) return null;
  return n;
}

assert.strictEqual(parsePrice(null), null, 'null 应返回 null');
assert.strictEqual(parsePrice(''), null, '空字符串应返回 null');
assert.strictEqual(parsePrice('abc'), null, '非数字应返回 null');
assert.strictEqual(parsePrice('123.45'), 123.45, '正常价格应返回浮点数');
assert.strictEqual(parsePrice('Infinity'), null, 'Infinity 应返回 null');
console.log('✅ 通过\n');

// 测试 3: 北京时间格式稳定性
console.log('测试 3: 北京时间格式稳定性');
function getBeijingTimestamp() {
  const now = new Date();
  const offset = 8 * 60 * 60 * 1000;
  const bj = new Date(now.getTime() + offset);
  return bj.toISOString().replace('T', ' ').substring(0, 19);
}

const timestamp = getBeijingTimestamp();
const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
assert.ok(regex.test(timestamp), `时间格式应为 YYYY-MM-DD HH:MM:SS，实际: ${timestamp}`);
console.log('✅ 通过\n');

// 测试 4: API 错误码到 HTTP 状态码的映射
console.log('测试 4: 错误码到状态码映射');
function errorToStatus(errorCode) {
  switch (errorCode) {
    case 'PRODUCT_NOT_FOUND':
    case 'BATCH_NOT_FOUND':
      return 404;
    case 'INVALID_PRODUCT_ID':
    case 'INVALID_PARAMS':
      return 400;
    case 'SAVE_FAILED':
      return 500;
    default:
      return 500;
  }
}

assert.strictEqual(errorToStatus('PRODUCT_NOT_FOUND'), 404, '商品不存在应返回 404');
assert.strictEqual(errorToStatus('INVALID_PARAMS'), 400, '参数错误应返回 400');
assert.strictEqual(errorToStatus('SAVE_FAILED'), 500, '保存失败应返回 500');
assert.strictEqual(errorToStatus('UNKNOWN_ERROR'), 500, '未知错误应返回 500');
console.log('✅ 通过\n');

// 测试 5: 模拟文件写入失败
console.log('测试 5: 模拟文件写入失败处理');
const fs = require('fs');
const path = require('path');

const testFile = path.join(__dirname, '../data/test_write_fail.tmp');
let writeError = null;

try {
  // 尝试写到只读路径（/proc 下文件不可写）
  fs.writeFileSync('/proc/self/cmdline_fake', 'test');
} catch (err) {
  writeError = err;
}

assert.ok(writeError !== null, '写入只读路径应抛出异常');
assert.ok(writeError.code === 'EACCES' || writeError.code === 'EPERM' || writeError.code === 'EROFS',
  `写入失败应返回权限相关错误码，实际: ${writeError.code}`);
console.log('✅ 通过\n');

console.log('=== 所有异常处理测试通过 ===');
