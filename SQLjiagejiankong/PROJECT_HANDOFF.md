# 天猫价格监控系统 - 项目交接文档

## 1. 项目目标和关键约定

### 核心目标
监控天猫商品SKU的活动价变化，提供Web界面查看历史价格对比。

### 关键约定
1. **Bug修复流程**：用户报告bug时，先分析根因并取得确认，再修改代码
2. **数据唯一键**：SKU由 `package_name + refraction` 唯一标识
3. **空活动价表示**：`promo_price === ''` 表示无活动价（前端显示"—"），存储时不能用字符串`'未知'`
4. **数据保留**：只保留最近3天数据，通过 `MAX(record_time)` 向前推3天（不依赖系统时间）
5. **内存数据库**：Web UI使用sql.js在内存中加载整个数据库，**抓取新数据后必须重启Web UI才能看到更新**

### 技术限制
- 不能使用 better-sqlite3（需要编译，WSL2环境缺少build-essential且sudo需终端认证）
- 必须使用 sql.js（纯JavaScript实现）
- 不能安装需要编译的npm包

---

## 2. 已完成的功能

### 数据链路
```
天猫商品页 
  → 影刀(Windows)执行 tmall_sku_price_extractor.js 
  → 返回JSON数组 
  → 影刀执行 save_to_excel.py
  → 输出 Excel(~/Desktop/卫光2.xlsx) + JSON(C:\temp\current_price.json)
  → WSL读取 /mnt/c/temp/current_price.json 
  → node index.js 写入数据库
  → web-ui.js 读取数据库 
  → 浏览器 http://localhost:3000
```

### 后端功能
- **数据库**：SQLite (sql.js)，位于 `./data/price_monitor.db`
- **表结构**：`price_history(id, package_name, refraction, daily_price, promo_price, record_time)`
- **数据抓取**：`node index.js` 从 `/mnt/c/temp/current_price.json` 读取并写入数据库
- **商品元数据**：存于 `product-config.json` (brand, product_url, product_id)
- **数据清理**：`scripts/cleanup-old-data.js` 删除3天前数据（需手动执行）

### Web UI功能
- **统计面板**：商品数、SKU数、最后更新时间
- **日期选择**：左侧按查询日期/时间分组
- **SKU列表**：显示规格名称、日常价、活动价、库存
- **价格对比图表**：横向柱状图显示活动价变化（涨价红/降价绿）
  - 只显示 `Math.abs(change_value) > priceChangeThreshold` 的SKU
  - 只显示 `change_type` 为 `increased`/`decreased` 的记录
  - `new_promo`/`promo_removed`/`new_sku` 不进入图表

### API接口
| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查 + 记录数 |
| `GET /api/stats` | 统计信息（商品数、SKU数、最后更新等） |
| `GET /api/query-times` | 可用日期列表 (`?date=`查询该日所有时间) |
| `GET /api/products` | 指定时间的SKU快照 (`?date=` / `?record_time=`) |
| `GET /api/comparison` | 当前时间vs上一次的活动价对比 |

### 已修复的重大Bug
1. **空活动价数据污染**：
   - 问题：`priceMonitor.js` 把空活动价存为字符串`'未知'` → `parseFloat("未知")` = NaN → 图表崩溃
   - 修复：改为存储空字符串`''`，并用 `fix-promo-price.js` 修正150条存量数据

2. **前端DOM空指针错误**：
   - 问题：DOM未加载完成就访问元素的 `style` 属性 → `Cannot read properties of null (reading 'style')`
   - 修复：增加DOMContentLoaded事件监听、所有DOM访问前增加null检查

3. **前端请求缺陷**：
   - 增加10秒超时（AbortController）
   - 增加Content-Type检查
   - 统一的loading/error状态管理

4. **better-sqlite3编译失败**：
   - 从better-sqlite3完全重构为sql.js
   - 增加 `database.init()` / `database.save()` 方法

### 当前数据状态
- **数据库记录数**：287条
- **最新记录时间**：2026-10-25 05:31:08
- **SKU数量**：68
- **可用日期**：2026-10-25、2026-10-24
- **当前商品**：蔡司 (product_id: 563795984293)

### 配置文件
**config.js**：
```javascript
{
  paths: {
    database: './data/price_monitor.db',
    input: '/mnt/c/temp/current_price.json',
    logs: './logs'
  },
  priceThreshold: 5,
  dataRetentionDays: 3,
  priceChangeThreshold: 0,
  timezone: 'Asia/Shanghai'
}
```

---

## 3. 待办事项（尚未开始）

### 高优先级
1. **自动数据清理**
   - 引入 node-cron 定时清理超过3天的数据
   - 需改动：`package.json`、`index.js`、`config.js`

2. **Web UI自动更新机制**
   - 当前需手动重启，体验不佳
   - 可选方案：
     - 方案A：每次请求时重新读取数据库（性能较低）
     - 方案B：文件监控触发重载（inotify/chokidar）
     - 方案C：添加手动重载API端点 `POST /api/reload`
     - 方案D：改用支持持久连接的数据库（PostgreSQL等）

### 中优先级
3. **多商品支持**
   - 表结构需增加 `product_id` 字段
   - `product-config.json` 改为数组
   - Web UI增加商品选择器

4. **库存/上下架监控**
   - 记录库存数量变化
   - 检测商品下架（404/数据不可用）

5. **钉钉通知**
   - 配置已预留 `dingtalk.webhook` 和 `dingtalk.secret`
   - 需实现 `src/notifier.js` 的推送逻辑

### 低优先级
6. **前端实时刷新**
   - WebSocket/Server-Sent Events
   - 轮询最新数据

7. **更丰富的图表**
   - 日常价趋势
   - 多SKU对比
   - 时间序列分析

---

## 快速操作指南

### 抓取数据后的完整流程
```bash
# 1. 进入项目目录
cd /home/hahahaha/SQLjiagejiankong

# 2. 运行数据导入
node index.js

# 3. 重启Web UI（必须！否则看不到新数据）
pkill -f 'node web-ui.js'
node web-ui.js > /tmp/webui.log 2>&1 &

# 4. 验证服务
curl -s "http://localhost:3000/api/stats"
```

**一键执行版本**：
```bash
cd /home/hahahaha/SQLjiagejiankong && node index.js && pkill -f 'node web-ui.js' && node web-ui.js > /tmp/webui.log 2>&1 &
```

### 手动清理旧数据
```bash
cd /home/hahahaha/SQLjiagejiankong
node scripts/cleanup-old-data.js
# 清理完成后需要重启Web UI
```

### 检查服务状态
```bash
# 查看Web UI进程
ps aux | grep 'node web-ui.js' | grep -v grep

# 测试API
curl http://localhost:3000/health
curl http://localhost:3000/api/stats

# 查看日志
tail -f /tmp/webui.log
```

### 修复活动价数据问题（如遇到"未知"字符串）
```bash
cd /home/hahahaha/SQLjiagejiankong
node fix-promo-price.js
```

---

## 文件清单

### 核心文件
- `config.js` - 配置文件
- `index.js` - 数据抓取入口
- `web-ui.js` - Web服务器
- `product-config.json` - 商品元数据

### 源代码
- `src/database.js` - sql.js数据库封装
- `src/priceMonitor.js` - 价格监控核心逻辑
- `src/logger.js` - 日志工具
- `src/notifier.js` - 通知工具（未实现）
- `src/dataCleanup.js` - 数据清理工具

### 前端
- `public/index.html` - Web界面
- `public/style.css` - 样式表
- `public/app.js` - 前端JavaScript

### 脚本
- `scripts/cleanup-old-data.js` - 手动清理旧数据
- `fix-promo-price.js` - 修复活动价数据

### 文档
- `README.md` - 项目说明
- `WEB_UI_README.md` - Web UI使用指南
- `PYTHON_INTEGRATION.md` - Python集成说明
- `CHANGELOG_V2.md` - V2更新日志
- `IMPLEMENTATION_SUMMARY.md` - 实现总结
- `DIAGNOSIS_REPORT.md` - 诊断报告
- `TEST_RESULTS.md` - 最新测试结果

---

## 环境信息

### 系统
- **平台**：WSL2 Ubuntu (Linux 6.18.33.2-microsoft-standard-WSL2)
- **工作目录**：`/home/hahahaha/SQLjiagejiankong`
- **Node.js**：v24.20.0
- **npm**：11.19.0

### Git
- **仓库**：`git@github.com:chenhanshengchen/price-monitor.git`
- **分支**：master
- **认证**：SSH密钥 (`~/.ssh/id_ed25519`)

### 安全提醒
- ⚠️ 用户曾在对话中明文提供GitHub PAT，已建议撤销
- ✅ 已改用SSH密钥认证

---

## 技术债务

1. **内存数据库快照**：每次抓取后需手动重启Web UI
2. **无自动清理**：数据清理需手动执行脚本
3. **单商品限制**：只支持一个商品页面
4. **无实时更新**：前端不支持自动刷新
5. **node_modules污染**：曾被误提交到git（应加.gitignore）

---

## 新对话建议

开启新对话时，可以这样提问：

> "我想实现Web UI自动更新机制，不需要每次抓取数据后手动重启服务。你有什么建议？请先说明各方案的优缺点和实现复杂度。"

或：

> "帮我实现自动数据清理功能，使用node-cron每天凌晨3点自动删除3天前的数据。"

---

**文档生成时间**：2026-10-26  
**最后更新人**：Claude Code (Sonnet 5)
