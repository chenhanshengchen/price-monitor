# 价格监控系统使用说明

## 功能概述
监控商品价格变动，当价格波动超过10元时记录到数据库并输出日志。

## 目录结构
```
SQLjiagejiankong/
├── config.js           # 配置文件
├── index.js            # 主入口
├── package.json        # 项目配置
├── src/
│   ├── database.js     # 数据库操作
│   ├── logger.js       # 日志模块
│   └── priceMonitor.js # 核心监控逻辑
├── input/              # 输入数据目录
│   └── current_price.json  # 价格数据文件（需手动放置）
├── data/               # 数据存储目录（自动创建）
│   └── price_monitor.db    # SQLite数据库
├── logs/               # 日志目录（自动创建）
│   └── monitor_YYYY-MM-DD.log
└── test/
    └── test.js         # 测试脚本

```

## 快速开始

### 1. 准备输入数据
在 `input/` 目录下创建 `current_price.json`，格式如下：

```json
[
  {
    "镜片套餐": "防蓝光镜片",
    "折射率": "1.56",
    "日常价": "128.00",
    "活动价": "99.00"
  },
  {
    "镜片套餐": "超薄镜片",
    "折射率": "1.67",
    "日常价": "258.00",
    "活动价": "199.00"
  }
]
```

### 2. 运行监控
```bash
npm start
# 或
node index.js
```

### 3. 查看结果
- **日志文件**：`logs/monitor_YYYY-MM-DD.log`
- **数据库**：`data/price_monitor.db`

## Python 数据对接

在 Python 脚本中输出 JSON 到指定路径：

```python
import json
import os

# 假设 result_list 是你处理好的数据
result_list = [
    {
        "镜片套餐": "防蓝光镜片",
        "折射率": "1.56",
        "日常价": "128.00",
        "活动价": "99.00"
    }
]

# 输出路径
output_path = "/home/hahahaha/SQLjiagejiankong/input/current_price.json"

# 确保目录存在
os.makedirs(os.path.dirname(output_path), exist_ok=True)

# 写入 JSON
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(result_list, f, ensure_ascii=False, indent=2)

print(f"数据已保存到: {output_path}")
```

## 配置说明

编辑 `config.js` 修改配置：

```javascript
module.exports = {
  paths: {
    database: './data/price_monitor.db',  // 数据库路径
    input: './input/current_price.json',  // 输入文件路径
    logs: './logs'                        // 日志目录
  },
  priceThreshold: 10  // 价格变动阈值（元）
};
```

## 定时执行（Linux Cron）

编辑 crontab：
```bash
crontab -e
```

添加定时任务（每5分钟执行一次）：
```cron
*/5 * * * * cd /home/hahahaha/SQLjiagejiankong && /home/hahahaha/.nvm/versions/node/v24.20.0/bin/node index.js >> /home/hahahaha/SQLjiagejiankong/logs/cron.log 2>&1
```

查看 Node.js 路径：
```bash
which node
```

## 数据库查询

查看价格历史：
```bash
sqlite3 data/price_monitor.db
```

SQL 查询示例：
```sql
-- 查看所有记录
SELECT * FROM price_history ORDER BY record_time DESC;

-- 查看特定商品的价格变化
SELECT * FROM price_history 
WHERE package_name = '防蓝光镜片' AND refraction = '1.56'
ORDER BY record_time DESC;

-- 统计商品数量
SELECT COUNT(DISTINCT package_name || refraction) as count FROM price_history;
```

## 测试

运行测试脚本：
```bash
npm test
```

测试会：
1. 清理测试环境
2. 创建测试数据并首次运行（建立基线）
3. 修改数据并再次运行（检测价格变动）
4. 验证数据库和日志文件创建成功

## 故障排查

### 问题：没有检测到价格变动
- 检查价格变动是否超过阈值（默认10元）
- 查看日志文件确认数据读取正常

### 问题：输入文件不存在
- 确认 `input/current_price.json` 文件存在
- 检查文件路径和权限

### 问题：数据库错误
- 删除 `data/price_monitor.db` 重新运行
- 检查目录写入权限

## 系统要求

- Node.js v14+
- better-sqlite3（已安装）
- Linux/WSL2 环境
