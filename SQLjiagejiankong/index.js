const PriceMonitor = require('./src/priceMonitor');
const fs = require('fs');
const path = require('path');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { file: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      result.file = args[i + 1];
      i++;
    }
  }

  return result;
}

// 读取并解析 JSON 文件，校验必要字段
// 支持新格式 {itemId, title, url, skus:[...]}
// 兼容旧格式 [...] (纯数组，归属商品 ID 1)
function readAndValidateJson(filePath) {
  if (!filePath) {
    console.error('错误: 缺少 --file 参数');
    console.error('用法: node index.js --file <JSON文件路径>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`错误: 文件不存在: ${filePath}`);
    process.exit(1);
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    console.error(`错误: 无法读取文件: ${filePath}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`错误: 读取文件失败: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`错误: JSON 格式错误: ${err.message}`);
    console.error(`文件位置: ${filePath}`);
    process.exit(1);
  }

  // 兼容旧格式：纯数组
  if (Array.isArray(parsed)) {
    console.warn('警告: 检测到旧格式 JSON（纯数组），已默认归属商品 platform_id=563795984293');
    return {
      itemId: '563795984293',
      title: '',
      url: '',
      skus: parsed,
      _isLegacyFormat: true
    };
  }

  // 新格式校验
  if (!parsed.itemId || typeof parsed.itemId !== 'string' || parsed.itemId.trim() === '') {
    console.error('错误: JSON 缺少 itemId 字段或为空');
    process.exit(1);
  }

  if (!Array.isArray(parsed.skus) || parsed.skus.length === 0) {
    console.error('错误: JSON 缺少 skus 字段或为空数组');
    process.exit(1);
  }

  // 影刀 JS 校验失败（价格冲突/结构错误）的数据不能作为正常批次导入
  const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  if (conflicts.length > 0 || errors.length > 0) {
    console.error(`错误: 数据校验失败，价格冲突 ${conflicts.length} 条，结构错误 ${errors.length} 条，拒绝导入`);
    process.exit(1);
  }

  if (!parsed.title || !parsed.url) {
    console.warn('警告: JSON 缺少 title 或 url 字段，已使用默认空值');
  }

  return {
    itemId: parsed.itemId.trim(),
    title: parsed.title || '',
    url: parsed.url || '',
    // 店铺名、货号：旧版影刀输出没有这两个字段，缺失时为空，不影响导入
    shopName: typeof parsed.shopName === 'string' ? parsed.shopName : '',
    articleNumber: typeof parsed.articleNumber === 'string' ? parsed.articleNumber : '',
    skus: parsed.skus
  };
}

async function main() {
  const { file } = parseArgs();
  const payload = readAndValidateJson(file);

  const monitor = new PriceMonitor();
  await monitor.runWithPayload(payload);
}

main().catch(error => {
  console.error('程序执行失败:', error.message);
  process.exit(1);
});

