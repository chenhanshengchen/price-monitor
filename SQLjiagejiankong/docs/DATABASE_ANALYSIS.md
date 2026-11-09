# 价格监控系统 - 数据库存储分析报告

## 执行时间
2026-10-31

## 一、当前数据流时间线

### 完整数据流向图

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 数据源 (影刀RPA抓取)                                          │
│    ├─ 抓取天猫商品页面                                           │
│    └─ 输出: /mnt/c/temp/current_price.json                      │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. 数据读取 (PriceMonitor.readJSON)                             │
│    ├─ 位置: config.paths.input                                  │
│    ├─ 格式验证: 检查数组格式                                     │
│    └─ 字段: 镜片套餐, 折射率, 日常价, 活动价                     │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. 数据处理 (PriceMonitor.processData)                          │
│    ├─ 遍历每条商品数据                                           │
│    ├─ 查询数据库最新价格 (getLatestPrice)                       │
│    ├─ 价格对比 (阈值: 5元)                                      │
│    └─ 检测价格变动                                              │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. 数据存储 (PriceDatabase.insertPrice)                         │
│    ├─ 表: price_history                                         │
│    ├─ 字段:                                                     │
│    │   ├─ id (自增主键)                                         │
│    │   ├─ package_name (镜片套餐)                              │
│    │   ├─ refraction (折射率)                                  │
│    │   ├─ daily_price (日常价)                                 │
│    │   ├─ promo_price (活动价)                                 │
│    │   └─ record_time (记录时间)                               │
│    └─ 索引:                                                     │
│        ├─ idx_package_refraction                                │
│        └─ idx_record_time                                       │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. 通知推送 (如有价格变动)                                       │
│    ├─ 钉钉机器人 Webhook                                        │
│    └─ 日志记录                                                  │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. 数据展示 (Web UI)                                            │
│    ├─ Express Server (端口: 3000)                              │
│    ├─ API 端点:                                                │
│    │   ├─ /api/query-times (查询时间列表)                      │
│    │   ├─ /api/products (商品价格列表)                         │
│    │   ├─ /api/skus/:sku_key/history (SKU历史)                │
│    │   ├─ /api/comparison (价格对比)                           │
│    │   └─ /api/stats (统计信息)                                │
│    └─ 数据保留: 3天                                            │
└─────────────────────────────────────────────────────────────────┘
```

## 二、当前数据库状态

### 数据统计（截至最后抓取）
- **总记录数**: 287 条
- **时间范围**: 2026-10-19 08:49:06 至 2026-10-25 05:31:08
- **不同 SKU 数量**: 83 个
- **数据库文件大小**: 268KB
- **数据保留策略**: 3天

### 每日记录数
```
2026-10-25: 204 条记录
2026-10-24: 68 条记录
2026-10-19: 15 条记录
```

### 数据完整性
✅ 每次抓取会记录所有 SKU 的价格
✅ 支持增量更新（新商品自动添加）
⚠️ 空活动价存储为空字符串 ""

## 三、不同商品的数据处理差异

### 商品分类
根据数据分析，所有商品（不同SKU）的处理流程**完全一致**：

1. **存储方式相同**
   - 所有SKU使用相同的表结构
   - 通过 `package_name` + `refraction` 组合唯一标识

2. **查询方式相同**
   - 每个SKU都基于 (package_name, refraction) 查询最新价格
   - 使用相同的索引优化

3. **监控逻辑相同**
   - 所有SKU使用统一的价格阈值（5元）
   - 同样的变动检测算法

### 特殊情况处理
- **活动价为空**: 存储为空字符串 `""`
- **价格未知**: 存储为字符串 `"未知"`
- **新商品**: 首次入库不触发变动通知

## 四、主要问题与风险

### 🔴 严重问题

1. **数据类型设计缺陷**
   ```sql
   -- 当前设计（错误）
   daily_price TEXT NOT NULL
   promo_price TEXT NOT NULL
   
   -- 应该使用数值类型
   daily_price REAL NOT NULL
   promo_price REAL  -- 可为NULL
   ```
   - **影响**: 无法使用数据库进行价格计算、排序、聚合
   - **风险**: 应用层解析增加复杂度，性能下降

2. **缺少业务主键约束**
   ```sql
   -- 当前设计：允许同一时间点同一SKU重复插入
   -- 应该添加唯一约束
   UNIQUE(package_name, refraction, record_time)
   ```
   - **影响**: 可能产生重复数据
   - **风险**: 数据统计不准确

3. **无数据完整性检查**
   - 缺少 CHECK 约束验证价格非负
   - 缺少外键关系管理
   - package_name 允许为空字符串

### 🟡 性能问题

4. **表扫描风险**
   ```sql
   -- web-ui.js 中的查询
   SELECT * FROM price_history WHERE record_time = ?
   ```
   - 当前索引: `idx_record_time`
   - **问题**: 每次查询可能返回 80+ 行（所有SKU）
   - **优化**: 需要复合索引

5. **缺少分区策略**
   - 287 条记录尚可，但增长后会有性能问题
   - 无时间分区或归档机制

6. **N+1 查询问题**
   ```javascript
   // priceMonitor.js:56
   for (const item of data) {
     const latest = this.db.getLatestPrice(packageName, refraction);
     // 每个SKU执行一次查询
   }
   ```
   - **影响**: 83个SKU = 83次数据库查询
   - **应该**: 一次查询获取所有最新价格

### 🟢 架构问题

7. **缺少商品主表**
   ```
   当前: 只有 price_history 表
   建议: products 表 + price_history 表
   ```
   - 商品元信息（套餐名称、折射率）每次都重复存储
   - 无法追踪商品的上架/下架状态

8. **数据冗余**
   - `package_name` 和 `refraction` 在每条记录中重复
   - 对于长商品名称，空间浪费严重

9. **缺少审计追踪**
   - 无法知道数据来源（哪次RPA任务）
   - 无法追踪数据修改历史
   - 缺少数据质量标记

## 五、推荐优化方案

### 优先级 P0 - 立即执行

#### 1. 修复数据类型
```sql
-- 创建新表结构
CREATE TABLE price_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,  -- 外键到 products 表
  daily_price REAL NOT NULL,
  promo_price REAL,  -- NULL 表示无活动价
  record_time DATETIME NOT NULL,
  UNIQUE(product_id, record_time),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 创建商品主表
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL,
  refraction TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active',  -- active, discontinued
  UNIQUE(package_name, refraction)
);
```

#### 2. 优化查询性能
```sql
-- 复合索引
CREATE INDEX idx_product_record ON price_history_new(product_id, record_time DESC);

-- 部分索引（仅活动价格）
CREATE INDEX idx_promo_price ON price_history_new(promo_price) WHERE promo_price IS NOT NULL;
```

#### 3. 消除 N+1 查询
```javascript
// 优化前: 83次查询
for (const item of data) {
  const latest = this.db.getLatestPrice(packageName, refraction);
}

// 优化后: 1次查询
const latestPrices = this.db.getBatchLatestPrices();
for (const item of data) {
  const key = `${packageName}#${refraction}`;
  const latest = latestPrices[key];
}
```

### 优先级 P1 - 1周内完成

#### 4. 添加数据质量检查
```sql
-- 价格约束
ALTER TABLE price_history_new ADD CHECK (daily_price >= 0);
ALTER TABLE price_history_new ADD CHECK (promo_price IS NULL OR promo_price >= 0);

-- 时间约束
ALTER TABLE price_history_new ADD CHECK (record_time <= datetime('now', '+1 day'));
```

#### 5. 实现批量插入
```javascript
// 当前: 逐条插入
this.db.insertPrice(packageName, refraction, dailyPrice, promoPrice);

// 优化: 批量插入（使用事务）
db.transaction(() => {
  const insert = db.prepare('INSERT INTO price_history ...');
  for (const item of data) {
    insert.run(...);
  }
});
```

#### 6. 添加数据来源追踪
```sql
CREATE TABLE data_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL,  -- 'yingdao_rpa', 'manual', 'api'
  record_count INTEGER,
  status TEXT,  -- 'success', 'partial', 'failed'
  error_message TEXT
);

-- price_history 添加外键
ALTER TABLE price_history_new ADD COLUMN import_id INTEGER REFERENCES data_imports(id);
```

### 优先级 P2 - 1月内完成

#### 7. 实现数据分区
```sql
-- 按月分区
CREATE TABLE price_history_2026_10 AS SELECT * FROM price_history WHERE ...;
CREATE TABLE price_history_2026_11 AS SELECT * FROM price_history WHERE ...;

-- 或使用视图统一查询
CREATE VIEW price_history_all AS
  SELECT * FROM price_history_2026_10
  UNION ALL
  SELECT * FROM price_history_2026_11;
```

#### 8. 添加缓存层
```javascript
// 使用 Redis 或内存缓存
const cache = new Map();

function getLatestPrices() {
  const cacheKey = 'latest_prices';
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  
  const result = db.query(...);
  cache.set(cacheKey, result, { ttl: 300 }); // 5分钟
  return result;
}
```

#### 9. 实现数据归档
```javascript
// 定期任务：将超过30天的数据归档到冷存储
async function archiveOldData() {
  // 导出到 JSON 或单独的归档数据库
  const oldData = db.query('SELECT * FROM price_history WHERE record_time < datetime("now", "-30 days")');
  fs.writeFileSync(`archive_${date}.json`, JSON.stringify(oldData));
  
  // 从主表删除
  db.query('DELETE FROM price_history WHERE record_time < datetime("now", "-30 days")');
}
```

## 六、预期效果

### 性能提升
- **查询速度**: 从 O(n) 降低到 O(log n)
- **批量插入**: 提升 10-50 倍性能
- **内存使用**: 减少 30-40% （通过规范化）

### 数据质量
- **零重复数据**: UNIQUE 约束保证
- **类型安全**: 数据库层面验证
- **完整追踪**: 可审计所有数据变更

### 可维护性
- **清晰的数据模型**: 商品与价格历史分离
- **易于扩展**: 可添加更多商品属性
- **便于调试**: 数据来源可追溯

## 七、迁移计划

### 阶段 1: 准备（1天）
1. 备份现有数据库
2. 编写迁移脚本
3. 在测试环境验证

### 阶段 2: 执行（半天）
1. 创建新表结构
2. 迁移现有数据
3. 更新应用代码
4. 切换到新表

### 阶段 3: 验证（1天）
1. 运行完整测试套件
2. 对比新旧数据一致性
3. 性能基准测试

### 阶段 4: 清理（按需）
1. 删除旧表
2. 更新文档
3. 团队培训

## 八、监控指标建议

### 数据库健康
- 表大小增长率
- 查询响应时间（P50, P95, P99）
- 慢查询数量
- 索引命中率

### 业务指标
- SKU 数量变化
- 价格变动频率
- 数据采集成功率
- 通知发送成功率

## 九、技术栈建议

根据 senior-backend skill 的最佳实践：

### 当前技术栈
- ✅ Node.js + Express
- ✅ SQLite (sql.js)
- ⚠️ 无 ORM（手写 SQL）

### 建议升级
1. **考虑 PostgreSQL** （如果数据量持续增长）
   - 更好的并发性能
   - 更强的数据完整性
   - 原生支持 JSON 查询

2. **引入 Prisma ORM**
   - 类型安全
   - 自动迁移管理
   - 查询构建器

3. **添加消息队列**（如果需要）
   - 解耦数据采集与处理
   - 支持重试机制
   - Redis + Bull

## 十、总结

### 当前系统评分
- **功能完整性**: ⭐⭐⭐⭐ (4/5)
- **性能**: ⭐⭐⭐ (3/5)
- **数据完整性**: ⭐⭐ (2/5)
- **可维护性**: ⭐⭐⭐ (3/5)
- **可扩展性**: ⭐⭐ (2/5)

### 核心建议
1. **立即修复数据类型问题**（阻止后续问题）
2. **添加唯一约束**（保证数据质量）
3. **优化 N+1 查询**（提升性能）
4. **规范化数据模型**（便于扩展）

---
报告生成时间: 2026-10-31
基于: senior-backend skill 最佳实践
