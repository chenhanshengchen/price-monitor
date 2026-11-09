# 价格监控可视化系统 V2 - 时间维度对比版

## 最新变更 (2026-10-22)

本次更新从**历史趋势查看模式**升级为**时间点对比模式**,专注于活动价变化监控。

## 核心改动

### 1. 时间维度架构
- **左侧 SKU 列表**: 按查询日期和查询时间分组,不再平铺全部 SKU
- **默认视图**: 只显示当天最新一次查询的数据
- **日期选择**: 只能查看最近 3 天的数据
- **同日多次查询**: 同一天存在多次查询时,可以选择具体查询时间

### 2. 数据保留策略
- **保留期限**: 只保留最近 3 天的价格记录
- **配置项**: `config.dataRetentionDays = 3`
- **清理方式**: 提供安全的数据清理函数,不会无条件删除数据
- **时区**: 使用 Asia/Shanghai 统一时区,避免浏览器本地时区问题

### 3. 图表变更
- **删除日常价**: 图表不再显示 `daily_price`
- **只分析活动价**: 只使用 `promo_price` 进行对比
- **对比模式**: 比较当前查询时间与上一次查询时间的活动价差异
- **降低高度**: 图表高度从 500px+ 降低到 360px
- **柱状图**: 使用横向柱状图,涨价红色、降价绿色

### 4. 阈值过滤
- **配置项**: `config.priceChangeThreshold = 0` (默认显示所有变化)
- **过滤规则**: 只显示价格变化绝对值超过阈值的 SKU
- **变化类型**:
  - `increased`: 涨价(超过阈值)
  - `decreased`: 降价(超过阈值)
  - `unchanged`: 无变化
  - `new_promo`: 从无活动价变为有活动价(默认不显示)
  - `promo_removed`: 从有活动价变为无活动价(默认不显示)
  - `new_sku`: 新增 SKU(默认不显示)

## 文件结构

```
SQLjiagejiankong/
├── config.js                    ← 新增配置: dataRetentionDays, priceChangeThreshold, timezone
├── web-ui.js                    ← 重构: 新增时间维度 API
├── src/
│   └── dataCleanup.js           ← 新增: 数据清理模块
├── public/
│   ├── index.html               ← 修改: 日期/时间选择器替代搜索框
│   ├── app.js                   ← 重构: 时间分组 + 对比图表逻辑
│   └── style.css                ← 修改: 降低图表高度,新增选择器样式
└── WEB_UI_README.md             ← 待更新
```

## API 变更

### 新增接口

#### 1. 获取可用查询时间
```
GET /api/query-times
```
返回最近 3 天的所有查询日期和时间

```
GET /api/query-times?date=2026-10-22
```
返回指定日期的所有查询时间

#### 2. 活动价对比
```
GET /api/comparison?date=2026-10-22
GET /api/comparison?date=2026-10-22&record_time=2026-10-22T10:00:00
```
返回当前查询时间与上一次查询时间的活动价对比数据

### 修改接口

#### GET /api/products
**变更**: 从"返回所有 SKU 最新价格"改为"返回指定查询时间的 SKU 快照"

```
GET /api/products                             # 默认: 当天最新一次查询
GET /api/products?date=2026-10-22             # 指定日期最新一次查询
GET /api/products?date=2026-10-22&record_time=... # 指定具体查询时间
```

返回结构:
```json
{
  "product_url": "...",
  "product_id": "...",
  "brand": "...",
  "query_time": "2026-10-22T10:00:00",
  "sku_count": 15,
  "skus": [
    {
      "sku_key": "...",
      "package_name": "...",
      "refraction": "1.56",
      "daily_price": "199.00",
      "promo_price": "159.00",
      "record_time": "2026-10-22T10:00:00"
    }
  ]
}
```

#### GET /api/stats
**变更**: 新增 `retention_days` 和 `price_change_threshold` 字段

```json
{
  "product_count": 1,
  "sku_count": 15,
  "last_update": "2026-10-22T10:00:00",
  "retention_days": 3,
  "price_change_threshold": 0
}
```

### 删除接口
- `GET /api/skus/:sku_key/history` (不再需要历史趋势查询)

## 数据清理

### 手动清理
```javascript
const Database = require('better-sqlite3');
const { cleanupOldData } = require('./src/dataCleanup');

const db = new Database('./data/price_monitor.db');
const result = cleanupOldData(db);
console.log(`删除 ${result.deleted} 条记录,保留 ${result.remaining} 条记录`);
db.close();
```

### 自动清理
当前**不会**在应用启动时自动清理数据,需要手动执行或通过定时任务触发。

### 清理规则
```sql
DELETE FROM price_history
WHERE datetime(record_time) < datetime('now', '-3 days', 'localtime')
```

- 基于 `record_time` 字段
- 使用 `localtime` (Asia/Shanghai)
- 只删除早于保留窗口的数据
- 输出删除记录数

## 前端交互流程

### 页面默认行为
1. 加载最近 3 天的查询日期
2. 默认选择当天最新一次查询
3. 左侧展示该查询时间的所有 SKU
4. 右侧展示当前时间与上一次时间的活动价变化
5. 图表只显示超过阈值的 SKU

### 用户操作
1. **选择日期**: 切换到其他日期,显示该日期的数据
2. **选择时间**: 同一天多次查询时,选择具体查询时间
3. **查看对比**: 自动加载该时间与上一次时间的活动价对比

### 空状态处理
- 当天无数据: "当天暂无数据"
- 无可比较的历史数据: "无可比较的历史数据"
- 无超过阈值的变化: "无超过阈值的价格变化"

## 配置说明

### config.js
```javascript
module.exports = {
  paths: {
    database: './data/price_monitor.db',
    input: './input/current_price.json',
    logs: './logs'
  },
  priceThreshold: 5,              // 监控系统的价格阈值(未使用)
  dataRetentionDays: 3,           // 数据保留天数
  priceChangeThreshold: 0,        // 前端图表过滤阈值(¥)
  timezone: 'Asia/Shanghai'       // 统一时区
};
```

## 启动方式

```bash
cd /home/hahahaha/SQLjiagejiankong
npm run web

# 或指定端口
PORT=8080 node web-ui.js
```

访问: http://localhost:3000

## 技术债务

1. **sql.js 限制**: 使用只读内存数据库,无法写回磁盘(不影响本应用)
2. **数据清理**: 需要手动执行,未集成自动定时任务
3. **时区处理**: SQLite 使用 `localtime`,依赖系统时区设置为 Asia/Shanghai
4. **单商品限制**: 当前只支持一个商品页面
5. **无实时更新**: 需要手动刷新页面

## 已知问题

1. **数据库时间过旧**: 当前最新数据是 2026-10-19,今天是 2026-10-22,所以默认视图可能为空
2. **查询日期限制**: 只能查看最近 3 天,但数据库中有 9 月的旧数据

## 测试清单

### 后端 API
- [x] `/health` 返回正确的记录数和阈值配置
- [x] `/api/query-times` 返回最近 3 天的日期
- [x] `/api/query-times?date=YYYY-MM-DD` 返回指定日期的查询时间
- [x] `/api/products?date=YYYY-MM-DD` 返回指定日期的 SKU 快照
- [x] `/api/comparison?date=YYYY-MM-DD` 返回活动价对比数据
- [x] `record_time` 参数正确工作
- [x] 阈值过滤正确工作
- [x] 变化类型判断正确(increased/decreased/new_promo/promo_removed)

### 前端功能(需要浏览器测试)
- [ ] 页面默认显示当天数据(如果有)
- [ ] 日期选择器只显示最近 3 天
- [ ] 选择日期后 SKU 列表正确更新
- [ ] 同一天多次查询时显示时间选择器
- [ ] 图表显示活动价变化(不显示日常价)
- [ ] 图表高度明显降低(360px)
- [ ] 涨价显示红色,降价显示绿色
- [ ] Tooltip 显示完整信息
- [ ] 超过阈值的 SKU 正确显示
- [ ] 低于阈值的 SKU 不显示
- [ ] 空状态提示清晰
- [ ] 375px 宽度下页面基本可用

## 下一步建议

1. **添加数据**: 运行一次影刀抓取,生成当天的数据进行测试
2. **验证阈值**: 修改 `config.priceChangeThreshold` 为 10,验证过滤是否正常
3. **清理旧数据**: 手动执行数据清理,验证是否正确删除 3 天前的数据
4. **浏览器测试**: 在实际浏览器中测试所有交互功能
5. **定时清理**: 考虑添加 cron 任务定期清理旧数据

---

由 Claude Code 生成 | 更新时间: 2026-10-22
