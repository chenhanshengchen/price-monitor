// 查找天猫商品页数据中"店铺名"和"货号"所在的字段位置（只读，不修改页面）
//
// 用法：
// 1. 在浏览器打开商品详情页，等页面完全加载
// 2. 按 F12 打开开发者工具，切到 Console（控制台）
// 3. 把下面整段代码粘贴进去，回车
// 4. 复制全部输出发回（店铺 ID、卖家 ID 等数字可以打码，但字段路径如 res.seller.shopName 请保留）
//
// 建议在 2～3 个商品页各运行一次，并记下页面上显示的店铺名和货号（及其在页面上的位置）用于核对

(() => {
  const res = window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res;
  if (!res) return console.log('找不到 res，请等页面加载完再试');
  const out = [];
  const seen = new Set();
  const walk = (obj, path, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 8 || seen.has(obj)) return;
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) {
      const p = `${path}.${k}`;
      const keyHit = /shop|seller|store|nick|brand|货号|款号|型号/i.test(k);
      const valHit = typeof v === 'string' && /货号|款号|型号|旗舰店|专营店|专卖店/.test(v);
      if ((keyHit || valHit) && (typeof v !== 'object' || v === null)) {
        out.push(`${p} = ${String(v).slice(0, 80)}`);
      }
      if (valHit) out.push(`  ↳ 所在对象: ${JSON.stringify(obj).slice(0, 300)}`);
      if (typeof v === 'object') walk(v, p, depth + 1);
    }
  };
  walk(res, 'res', 0);
  console.log(`顶层字段: ${Object.keys(res).join(', ')}\n\n` + out.join('\n'));
})();
