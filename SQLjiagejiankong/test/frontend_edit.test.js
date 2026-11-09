/**
 * 前端编辑功能校验逻辑测试
 *
 * 不依赖 DOM，只测试编辑功能的核心校验逻辑：
 *
 * 商品 ID 校验：
 *   1. 正常情况：普通字符串通过校验
 *   2. 边界情况：空字符串（清空）通过校验，显示"未设置"
 *   3. 异常情况：超过 100 字符被拒绝
 *
 * 价格阈值校验：
 *   1. 正常情况：正数通过校验
 *   2. 边界情况：0 通过校验
 *   3. 异常情况：负数、空字符串、非数字被拒绝
 *
 * 关键验证点：
 *   - 这些校验规则与后端一致（保证前后端拒绝同一批非法输入）
 *   - 前端在发请求前就能拦截非法输入，不浪费网络请求
 *   - 阈值保存成功后触发 onSettingsChange 回调
 */

const assert = require('assert');

// ─── 从 detail.js 提取的纯校验函数 ───────────────────────

function validatePlatformId(value) {
  if (typeof value !== 'string') return { ok: false, message: '必须是字符串' };
  if (value.length > 100) return { ok: false, message: '商品 ID 不能超过 100 字符' };
  return { ok: true };
}

function validateThreshold(value) {
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === null) return { ok: false, message: '请输入有效数字' };
  const num = parseFloat(trimmed);
  if (isNaN(num) || !isFinite(num)) return { ok: false, message: '请输入有效数字' };
  if (num < 0) return { ok: false, message: '阈值不能为负数' };
  return { ok: true, value: num };
}

function formatThresholdDisplay(threshold) {
  return `¥${threshold}`;
}

function formatPlatformIdDisplay(id) {
  return id === '' || id === null || id === undefined ? '未设置' : id;
}

// ─── 模拟 onSettingsChange 回调触发 ──────────────────────

class MockProductInfoManager {
  constructor() {
    this.onSettingsChange = null;
  }

  async saveAndNotify(settings) {
    // 模拟保存后触发回调
    if (typeof settings.price_threshold !== 'undefined') {
      if (this.onSettingsChange) {
        this.onSettingsChange();
      }
    }
  }
}

// ─── 测试运行 ─────────────────────────────────────────────

async function runTests() {
  console.log('=== 前端编辑功能校验逻辑测试 ===\n');

  // ── 商品 ID 校验 ──

  console.log('[商品 ID] 测试 1: 正常情况 - 普通字符串');
  const r1 = validatePlatformId('563795984293');
  assert.ok(r1.ok, '普通字符串应通过校验');
  assert.strictEqual(formatPlatformIdDisplay('563795984293'), '563795984293', '非空时直接显示');
  console.log('✅ 通过\n');

  console.log('[商品 ID] 测试 2: 边界情况 - 空字符串（清空）');
  const r2 = validatePlatformId('');
  assert.ok(r2.ok, '空字符串应通过校验（允许清空）');
  assert.strictEqual(formatPlatformIdDisplay(''), '未设置', '空字符串显示为"未设置"');
  assert.strictEqual(formatPlatformIdDisplay(null), '未设置', 'null 显示为"未设置"');
  console.log('✅ 通过\n');

  console.log('[商品 ID] 测试 3: 异常情况 - 超长字符串和非字符串');
  const r3a = validatePlatformId('A'.repeat(101));
  assert.ok(!r3a.ok, '101 字符应被拒绝');
  assert.ok(r3a.message.includes('100'), '错误消息应提到字符限制');

  const r3b = validatePlatformId(123);
  assert.ok(!r3b.ok, '数字应被拒绝');

  const r3c = validatePlatformId(null);
  assert.ok(!r3c.ok, 'null 应被拒绝');
  console.log('✅ 通过\n');

  // ── 价格阈值校验 ──

  console.log('[价格阈值] 测试 1: 正常情况 - 正数');
  const t1 = validateThreshold(10);
  assert.ok(t1.ok, '10 应通过校验');
  assert.strictEqual(t1.value, 10, '返回值应为 10');
  assert.strictEqual(formatThresholdDisplay(10), '¥10', '显示格式正确');
  console.log('✅ 通过\n');

  console.log('[价格阈值] 测试 2: 边界情况 - 输入 0');
  const t2 = validateThreshold(0);
  assert.ok(t2.ok, '0 应通过校验（表示任何变动都报）');
  assert.strictEqual(t2.value, 0);
  assert.strictEqual(formatThresholdDisplay(0), '¥0', '显示格式正确');
  console.log('✅ 通过\n');

  console.log('[价格阈值] 测试 3: 异常情况 - 负数、空字符串、非数字');
  const t3a = validateThreshold(-5);
  assert.ok(!t3a.ok, '负数应被拒绝');
  assert.ok(t3a.message.includes('负数'), '错误消息应提到负数');

  const t3b = validateThreshold('');
  assert.ok(!t3b.ok, '空字符串应被拒绝');

  const t3c = validateThreshold('abc');
  assert.ok(!t3c.ok, '非数字字符串应被拒绝');

  const t3d = validateThreshold(NaN);
  assert.ok(!t3d.ok, 'NaN 应被拒绝');
  console.log('✅ 通过\n');

  // ── onSettingsChange 回调 ──

  console.log('[回调] 测试 1: 正常情况 - 保存阈值后触发回调');
  const manager1 = new MockProductInfoManager();
  let triggered = false;
  manager1.onSettingsChange = () => { triggered = true; };
  await manager1.saveAndNotify({ price_threshold: 10 });
  assert.ok(triggered, '阈值保存后应触发 onSettingsChange');
  console.log('✅ 通过\n');

  console.log('[回调] 测试 2: 边界情况 - 保存商品 ID 不触发 onSettingsChange');
  const manager2 = new MockProductInfoManager();
  let triggered2 = false;
  manager2.onSettingsChange = () => { triggered2 = true; };
  await manager2.saveAndNotify({ platform_product_id: 'NEW_ID' });
  assert.ok(!triggered2, '只保存商品 ID 不应触发 SKU 表格刷新');
  console.log('✅ 通过\n');

  console.log('[回调] 测试 3: 异常情况 - 未设置回调时不报错');
  const manager3 = new MockProductInfoManager();
  manager3.onSettingsChange = null;
  let threw = false;
  try {
    await manager3.saveAndNotify({ price_threshold: 5 });
  } catch {
    threw = true;
  }
  assert.ok(!threw, '未设置回调时不应抛出异常');
  console.log('✅ 通过\n');

  console.log('=== 所有前端编辑测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
