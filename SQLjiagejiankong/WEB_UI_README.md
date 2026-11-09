# 价格监控可视化系统 - 使用指南

## 这是什么?

这是一个**网页版的价格监控工具**,可以在浏览器中查看天猫商品的价格历史,比 Excel 更直观。

**功能**:
- 在浏览器中看到所有 SKU(套餐+折射率)的当前价格
- 点击任意 SKU,查看它的价格历史图表
- 搜索特定的套餐或折射率

## 快速开始 (小白版)

### 第一步: 检查你的电脑是否已安装依赖

你的电脑**已经安装**了必要的依赖(`sql.js` 和 `express`),所以**不需要再运行 `npm install`**。

可以用以下命令验证:
```bash
cd /home/hahahaha/SQLjiagejiankong
ls node_modules | grep -E "sql.js|express"
```

如果看到这两个名字,说明已经安装好了。

### 第二步: 配置商品信息

编辑 `product-config.json` 文件,填入真实的商品信息:

```bash
cd /home/hahahaha/SQLjiagejiankong
nano product-config.json
```

修改为:
```json
{
  "product_url": "你的天猫商品链接",
  "product_id": "商品ID",
  "brand": "品牌名称(比如:蔡司)"
}
```

按 `Ctrl+O` 保存,按 `Ctrl+X` 退出。

### 第三步: 启动 Web 服务

```bash
cd /home/hahahaha/SQLjiagejiankong
npm run web
```

或者直接运行:
```bash
node web-ui.js
```

看到这个提示说明启动成功:
```
Price Monitor Web UI running at http://localhost:3000
```

### 第四步: 在浏览器中查看

打开浏览器,访问:
```
http://localhost:3000
```

你会看到:
- **顶部**: 商品信息和统计数据
- **左侧**: 所有 SKU 列表(可以搜索)
- **右侧**: 点击 SKU 后显示价格历史图表

### 第五步: 停止服务

在终端按 `Ctrl+C` 即可停止服务。

## 我需要重新安装依赖吗?

**不需要!** 你的项目已经安装了以下依赖:
- `sql.js`: 用于读取数据库
- `express`: 用于运行 Web 服务器
- `better-sqlite3`: 之前的数据库工具(现在不用了,但保留着)

除非你删除了 `node_modules` 目录,否则**不需要再运行 `npm install`**。

如果确实需要重新安装,运行:
```bash
cd /home/hahahaha/SQLjiagejiankong
npm install
```

## 常见问题

### Q1: 启动后提示 "端口 3000 被占用"

**原因**: 端口 3000 已经被其他程序使用。

**解决方法**:
方法 1 - 使用其他端口:
```bash
PORT=8080 node web-ui.js
```
然后访问 `http://localhost:8080`

方法 2 - 找到占用端口的程序并关闭:
```bash
lsof -i :3000
kill -9 <PID>
```

### Q2: 页面显示 "无商品数据"

**原因**: 数据库中没有数据或配置文件错误。

**解决方法**:
1. 检查数据库是否有数据:
```bash
cd /home/hahahaha/SQLjiagejiankong
node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');
initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync('./data/price_monitor.db'));
  const result = db.exec('SELECT COUNT(*) FROM price_history');
  console.log('数据库记录数:', result[0].values[0][0]);
  db.close();
});
"
```

2. 检查 `product-config.json` 是否存在且格式正确

### Q3: 页面加载很慢

**原因**: `sql.js` 需要把整个数据库加载到内存中。

**这是正常的**,第一次加载会慢一些。如果数据库很大(超过 50MB),考虑清理旧数据。

### Q4: 图表不显示

**原因**: Chart.js CDN 加载失败或 SKU 没有历史数据。

**解决方法**:
1. 打开浏览器控制台(按 F12),查看是否有红色错误
2. 检查网络连接(Chart.js 从 jsdelivr.net 加载)
3. 确认该 SKU 有历史数据

### Q5: 搜索不工作

**原因**: JavaScript 错误或搜索框没有焦点。

**解决方法**:
1. 刷新页面(按 F5)
2. 点击搜索框确保它获得焦点
3. 打开浏览器控制台查看错误信息

## 数据说明

### 什么是 SKU?

**SKU** = 一个具体的商品规格

例如:
- 商品: 蔡司镜片
- SKU 1: 防蓝光镜片 + 1.56 折射率
- SKU 2: 防蓝光镜片 + 1.60 折射率
- SKU 3: 超薄镜片 + 1.67 折射率

每个 SKU 都有自己的价格和历史记录。

### 价格说明

- **日常价**: 平时的价格
- **活动价**: 促销时的价格(没有活动时显示 "无活动价" 或 "—")

### 数据从哪里来?

数据来自:
1. **数据库**: `/home/hahahaha/SQLjiagejiankong/data/price_monitor.db`
2. **影刀抓取的 JSON**: `/home/hahahaha/SQLjiagejiankong/input/current_price.json`

影刀每次抓取后会更新 JSON 文件,然后监控系统把数据存入数据库。

## 技术细节 (可选阅读)

### 文件结构

```
SQLjiagejiankong/
├── web-ui.js              ← Web 服务器主程序
├── product-config.json    ← 商品信息配置
├── package.json           ← 依赖列表
├── public/                ← 前端文件
│   ├── index.html         ← 页面结构
│   ├── style.css          ← 样式
│   └── app.js             ← 前端逻辑
├── data/
│   └── price_monitor.db   ← 数据库
└── input/
    └── current_price.json ← 影刀抓取的数据
```

### 数据模型

**商品 (Product)**:
- `product_url`: 商品链接
- `product_id`: 商品 ID
- `brand`: 品牌

**SKU**:
- `package_name`: 套餐名称(例如: "防蓝光镜片")
- `refraction`: 折射率(例如: "1.56")
- `daily_price`: 日常价
- `promo_price`: 活动价(空表示无活动)
- `record_time`: 记录时间

**SKU 唯一性** = `商品链接 + 套餐名称 + 折射率`

### 数据库表结构

```sql
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL,      -- 套餐名称
  refraction TEXT NOT NULL,        -- 折射率
  daily_price TEXT NOT NULL,       -- 日常价
  promo_price TEXT NOT NULL,       -- 活动价(空字符串表示无活动)
  record_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 为什么用配置文件而不是数据库存储商品信息?

**原因**: 数据库表中没有 `brand`、`product_url`、`product_id` 字段。

**方案**: 通过 `product-config.json` 配置文件提供这些信息,这样:
- ✅ 不修改现有数据库结构
- ✅ 保持数据完整性
- ✅ 完全可回滚

如果将来需要监控多个商品,可以修改数据库表结构添加这些字段。

## API 文档 (开发者可选)

### 1. 健康检查
```
GET /health
```

响应示例:
```json
{
  "status": "ok",
  "database": "connected",
  "records": 800
}
```

### 2. 获取商品和 SKU 列表
```
GET /api/products
```

响应示例:
```json
[
  {
    "product_url": "https://detail.tmall.com/item.htm?id=123",
    "product_id": "123",
    "brand": "蔡司",
    "sku_count": 486,
    "skus": [
      {
        "sku_key": "Base64编码的标识符",
        "package_name": "防蓝光镜片",
        "refraction": "1.56",
        "daily_price": "128.00",
        "promo_price": "99.00",
        "last_time": "2026-10-19 08:49:06"
      }
    ]
  }
]
```

**说明**:
- `sku_key`: 由后端生成的安全标识符,前端不要自行拼接
- `promo_price`: `null` 表示无活动价

### 3. 获取 SKU 历史价格
```
GET /api/skus/:sku_key/history?days=30
```

参数:
- `sku_key`: 由 `/api/products` 返回的 SKU 标识
- `days`: 查询天数(1-365,默认 30)

响应示例:
```json
[
  {
    "date": "2026-10-10",
    "daily_price": "128.00",
    "promo_price": "99.00"
  },
  {
    "date": "2026-10-11",
    "daily_price": "128.00",
    "promo_price": null
  }
]
```

错误响应:
```json
{
  "error": "INVALID_PARAMETER",
  "message": "days must be an integer between 1 and 365"
}
```

### 4. 统计信息
```
GET /api/stats
```

响应示例:
```json
{
  "product_count": 1,
  "sku_count": 486,
  "last_update": "2026-10-19 08:49:06"
}
```

## 工作流程

```
影刀抓取价格
    ↓
保存到 input/current_price.json
    ↓
Python 脚本读取 JSON
    ↓
写入 SQLite 数据库
    ↓
Web UI 读取数据库
    ↓
浏览器显示图表
```

## 当前限制

1. **单商品页面**: 当前只支持监控一个商品页面(可以有多个 SKU)
2. **无实时更新**: 页面需要手动刷新查看最新数据
3. **只读数据库**: `sql.js` 从文件加载数据到内存,不能写回(影响不大,因为我们只读取数据)
4. **无库存监控**: 当前不监控库存和上下架状态
5. **移动端体验**: 主要针对桌面浏览器优化,手机上可用但不完美

## 未来可以做的优化

- [ ] 支持多个商品页面监控
- [ ] 实时数据推送(WebSocket)
- [ ] 导出 Excel 功能
- [ ] 价格告警规则配置
- [ ] 库存监控
- [ ] 移动端优化
- [ ] 暗色主题
- [ ] 更多图表类型(价格趋势、波动分析)

## 需要帮助?

如果遇到问题:
1. 检查本文档的"常见问题"部分
2. 查看终端的错误信息
3. 打开浏览器控制台(F12)查看前端错误
4. 检查数据库和配置文件

## 技术栈

- **后端**: Node.js + Express + sql.js
- **前端**: 原生 JavaScript + Chart.js 4.4.0
- **数据库**: SQLite
- **无需编译**: 所有依赖都是纯 JavaScript,不需要 C++ 编译

## 版本信息

- Node.js: 24.20.0
- npm: 11.19.0
- Express: 4.18.2
- sql.js: 1.12.0
- Chart.js: 4.4.0 (CDN)

---

由 Claude Code 生成 | 更新时间: 2026-10-22
