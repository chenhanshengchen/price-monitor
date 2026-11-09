// 活动价对比规则：网页对比、导入后自动推送、手动推送共用，保证三处判断一致

// 安全地将价格字符串转为浮点数，返回 null 表示无效
function parsePrice(str) {
  if (str === null || str === undefined) return null;
  const n = parseFloat(str);
  if (!isFinite(n) || isNaN(n)) return null;
  return n;
}

// 判断单个 SKU 本次与对比批次的活动价变化
// 涨跌金额严格大于阈值才算超阈值（increased / decreased）
// 返回 changeType: no_promo | promo_canceled | new_promo | increased | decreased | unchanged | invalid
function classifyChange(currentPromo, previousPromo, threshold) {
  if (currentPromo === null && previousPromo === null) {
    return { changeType: 'no_promo', changeAmount: null };
  }
  if (previousPromo !== null && currentPromo === null) {
    return { changeType: 'promo_canceled', changeAmount: null };
  }
  if (previousPromo === null && currentPromo !== null) {
    return { changeType: 'new_promo', changeAmount: null };
  }

  const curr = parsePrice(currentPromo);
  const prev = parsePrice(previousPromo);
  // 价格字符串损坏时 parseFloat 返回 NaN，标记为无效由调用方跳过
  if (curr === null || prev === null) {
    return { changeType: 'invalid', changeAmount: null };
  }

  const changeAmount = (curr - prev).toFixed(2);
  if (curr - prev > threshold) return { changeType: 'increased', changeAmount };
  if (prev - curr > threshold) return { changeType: 'decreased', changeAmount };
  return { changeType: 'unchanged', changeAmount };
}

// 推送范围：与网页"超阈值"标签一致，只包含涨价和降价
function isExceeded(changeType) {
  return changeType === 'increased' || changeType === 'decreased';
}

module.exports = { parsePrice, classifyChange, isExceeded };
