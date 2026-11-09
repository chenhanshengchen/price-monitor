// 影刀 JS 解析逻辑测试：用脱敏页面数据夹具模拟 window.__ICE_APP_CONTEXT__
// 运行: node test/yingdao_parse.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '../docs/影刀JS代码-修改版.js'), 'utf8');

function runExtract(res) {
  const ctx = { loaderData: { home: { data: { res } } } };
  const nodes = {};
  const document = {
    createElement() { return { style: {} }; },
    getElementById(id) { return nodes[id]; },
    body: {
      appendChild(el) {
        if (el.id) nodes[el.id] = el;
        // 模拟注入脚本在真实 window 中执行
        if (el.textContent) nodes.shadowbot_temp_data_div.innerText = JSON.stringify(ctx);
      },
      removeChild() {}
    }
  };
  const sandbox = { document, window: { location: { href: 'https://detail.tmall.com/item.htm?id=' + res.item.itemId } }, JSON };
  const fn = vm.runInNewContext('(' + src + ')', sandbox);
  const out = fn(null, null);
  // 影刀把返回值序列化后交给 Python，这里同样走一遍 JSON
  return typeof out === 'string' ? out : JSON.parse(JSON.stringify(out));
}

function price(p, sub) {
  const info = { price: { priceText: p } };
  if (sub !== undefined) info.subPrice = { priceText: sub };
  return info;
}

// 商品 A：三个分类组，第三组（度数）不影响价格
function productA() {
  return {
    item: { itemId: '111', title: '商品A' },
    skuBase: {
      props: [
        { pid: '1627207', name: '颜色分类', values: [{ vid: '11', name: '黑框' }, { vid: '12', name: '银框' }] },
        { pid: '20000', name: '镜片折射率', values: [{ vid: '21', name: '1.60 依视路钻晶' }] },
        { pid: '30000', name: '适用度数', values: [{ vid: '31', name: '0-400度' }, { vid: '32', name: '400-800度' }] }
      ],
      skus: [
        { skuId: '1', propPath: '1627207:11;20000:21;30000:31' },
        { skuId: '2', propPath: '1627207:11;20000:21;30000:32' },
        // propPath 顺序打乱，仍需按 pid 识别
        { skuId: '3', propPath: '30000:31;20000:21;1627207:12' },
        { skuId: '4', propPath: '1627207:12;30000:32;20000:21' }
      ]
    },
    skuCore: { sku2info: { 0: price('999'), 1: price('500', '450'), 2: price('500', '450'), 3: price('520', '470'), 4: price('520', '470') } }
  };
}

// 商品 B：A 选项文本含半角 |，B 为完整镜片描述
function productB() {
  return {
    item: { itemId: '222', title: '商品B' },
    skuBase: {
      props: [
        { pid: '1627207', name: '颜色分类', values: [{ vid: '41', name: '纯钛NT68003 | 枪色浅灰' }, { vid: '42', name: '纯钛NT68003 | 黑色' }] },
        { pid: '20000', name: '镜片折射率', values: [{ vid: '51', name: '依视路旗下品牌1.56高清镜片【0-400度】' }] }
      ],
      skus: [
        { skuId: '10', propPath: '1627207:41;20000:51' },
        { skuId: '11', propPath: '1627207:42;20000:51' }
      ]
    },
    // skuId 11 无活动价
    skuCore: { sku2info: { 0: price('1'), 10: price('300', '268'), 11: price('300') } }
  };
}

const results = [];
function test(name, fn) {
  try { fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name + ' — ' + e.message]); }
}

test('商品A：三组分类只保留前两组，第三组不同价格一致时合并', () => {
  const out = runExtract(productA());
  assert.deepStrictEqual(out.categoryNames, { A: '颜色分类', B: '镜片折射率' });
  assert.deepStrictEqual(out.stats, { propsCount: 3, rawSkuCount: 4, mergedCount: 2, conflictCount: 0, errorCount: 0 });
  assert.deepStrictEqual(out.skus, [
    { '镜片套餐': '银框', '折射率': '1.60 依视路钻晶', '日常价': '520', '活动价': '470' },
    { '镜片套餐': '黑框', '折射率': '1.60 依视路钻晶', '日常价': '500', '活动价': '450' }
  ]);
  assert.strictEqual(out.itemId, '111');
  assert.ok(!src.includes('镜片适合度数'), '不应再依赖固定分类名');
});

test('商品B：A 含 | 完整保留，B 来自第二分类，不再填颜色', () => {
  const out = runExtract(productB());
  const a = out.skus.map(s => s['镜片套餐']).sort();
  assert.deepStrictEqual(a, ['纯钛NT68003 | 枪色浅灰', '纯钛NT68003 | 黑色']);
  out.skus.forEach(s => assert.strictEqual(s['折射率'], '依视路旗下品牌1.56高清镜片【0-400度】'));
});

test('propPath 属性顺序变化时仍按 pid 找到 A、B', () => {
  const out = runExtract(productA());
  assert.ok(out.skus.some(s => s['镜片套餐'] === '银框' && s['折射率'] === '1.60 依视路钻晶'));
});

test('同一 A+B 价格冲突时明确失败，不覆盖', () => {
  const p = productA();
  p.skuCore.sku2info[2] = price('510', '450');
  const out = runExtract(p);
  assert.strictEqual(out.conflicts.length, 1);
  assert.deepStrictEqual(out.conflicts[0].existing, { skuIds: ['1'], '日常价': '500', '活动价': '450' });
  assert.deepStrictEqual(out.conflicts[0].incoming, { skuId: '2', '日常价': '510', '活动价': '450' });
  assert.strictEqual(out.skus.find(s => s['镜片套餐'] === '黑框')['日常价'], '500');
});

test('空活动价保持空字符串（不当作 0）', () => {
  const out = runExtract(productB());
  assert.strictEqual(out.skus.find(s => s['镜片套餐'] === '纯钛NT68003 | 黑色')['活动价'], '');
});

test('只有一个分类组时 B 为空且不丢弃', () => {
  const p = productB();
  p.skuBase.props.pop();
  p.skuBase.skus = [{ skuId: '10', propPath: '1627207:41' }, { skuId: '11', propPath: '1627207:42' }];
  const out = runExtract(p);
  assert.strictEqual(out.skus.length, 2);
  out.skus.forEach(s => assert.strictEqual(s['折射率'], ''));
  assert.strictEqual(out.errors.length, 0);
});

test('属性引用无法解析时明确诊断，不写成"未知规格"', () => {
  const p = productB();
  p.skuBase.skus[1].propPath = '1627207:99;20000:51';
  p.skuCore.sku2info[12] = price('1');
  const out = runExtract(p);
  assert.strictEqual(out.skus.length, 1);
  assert.deepStrictEqual(out.errors.map(e => e.skuId), ['11', '12']);
  assert.ok(!JSON.stringify(out.skus).includes('未知规格'));
});

test('两个商品相同 A+B 不跨商品合并（每次运行只处理一个商品）', () => {
  const p1 = productB();
  const p2 = productB();
  p2.item.itemId = '333';
  p2.skuCore.sku2info[10] = price('999', '888');
  const o1 = runExtract(p1);
  const o2 = runExtract(p2);
  assert.strictEqual(o1.itemId, '222');
  assert.strictEqual(o2.itemId, '333');
  const pick = o => o.skus.find(s => s['镜片套餐'] === '纯钛NT68003 | 枪色浅灰')['日常价'];
  assert.strictEqual(pick(o1), '300');
  assert.strictEqual(pick(o2), '999');
});

test('正常输出 skus 中只有四个固定字段，不混入调试信息', () => {
  const out = runExtract(productA());
  out.skus.forEach(s => assert.deepStrictEqual(Object.keys(s), ['镜片套餐', '折射率', '日常价', '活动价']));
});

// 店铺名、货号：结构取自三个真实商品页的控制台输出
function withShop(res, opts) {
  res.seller = { sellerNick: opts.shop, shopName: opts.shop };
  res.componentsVO = { storeCardVO: { shopName: opts.shop } };
  const basic = [{ propertyName: '品牌', valueName: 'X' }];
  for (let i = 1; i < opts.basicIndex; i++) basic.push({ propertyName: '参数' + i, valueName: 'v' });
  basic.push({ propertyName: '货号', valueName: opts.article });
  res.plusViewVO = { industryParamVO: { basicParamList: basic } };
  const items = [];
  for (let i = 0; i < opts.itemIndex; i++) items.push({ title: '参数' + i, text: ['v'] });
  items.push({ title: '货号', text: [opts.article] });
  res.componentsVO.extensionInfoVO = { infos: [{}, {}, {}, { items }] };
  return res;
}

test('店铺名和货号：1026813925559（货号在第 2 项）', () => {
  const out = runExtract(withShop(productA(), { shop: '博士眼镜官方旗舰店', article: 'NT68003', basicIndex: 1, itemIndex: 1 }));
  assert.strictEqual(out.shopName, '博士眼镜官方旗舰店');
  assert.strictEqual(out.articleNumber, 'NT68003');
});

test('店铺名和货号：563795984293（货号在第 10 / 14 项，按名称找到）', () => {
  const out = runExtract(withShop(productB(), { shop: '卫光眼镜专营店', article: '蔡司防蓝光新清锐', basicIndex: 9, itemIndex: 13 }));
  assert.strictEqual(out.shopName, '卫光眼镜专营店');
  assert.strictEqual(out.articleNumber, '蔡司防蓝光新清锐');
});

test('主位置为空时使用备用位置', () => {
  const res = withShop(productB(), { shop: '卫光眼镜专营店', article: 'M62809', basicIndex: 1, itemIndex: 1 });
  delete res.seller;
  res.plusViewVO.industryParamVO.basicParamList = [{ propertyName: '品牌', valueName: 'X' }];
  const out = runExtract(res);
  assert.strictEqual(out.shopName, '卫光眼镜专营店');
  assert.strictEqual(out.articleNumber, 'M62809');
});

test('没有货号、没有店铺数据时为空，SKU 和价格不受影响', () => {
  const base = runExtract(productB());
  assert.strictEqual(base.shopName, '');
  assert.strictEqual(base.articleNumber, '');
  const res = withShop(productB(), { shop: '店', article: '款号不算', basicIndex: 1, itemIndex: 1 });
  res.plusViewVO.industryParamVO.basicParamList[1].propertyName = '款号';
  res.componentsVO.extensionInfoVO.infos[3].items[1].title = '款号';
  const out = runExtract(res);
  assert.strictEqual(out.articleNumber, '');
  assert.deepStrictEqual(out.skus, base.skus);
});

test('店铺/货号数据结构异常时为空，SKU 和价格不受影响', () => {
  const base = runExtract(productB());
  const res = productB();
  // 页面数据经 JSON 序列化传入，只可能出现类型或结构不符，不会有抛异常的取值
  res.seller = null;
  res.plusViewVO = { industryParamVO: { basicParamList: [null, { propertyName: '货号' }, 5] } };
  res.componentsVO = { extensionInfoVO: { infos: [null, { items: [null] }] } };
  const out = runExtract(res);
  assert.strictEqual(typeof out, 'object', String(out));
  assert.strictEqual(out.shopName, '');
  assert.strictEqual(out.articleNumber, '');
  assert.deepStrictEqual(out.skus, base.skus);
});

results.forEach(([mark, name]) => console.log(mark, name));
const failed = results.filter(r => r[0] === '✗').length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
