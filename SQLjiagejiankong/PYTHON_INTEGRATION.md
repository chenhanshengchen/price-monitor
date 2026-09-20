# 价格监控系统 - Python 对接说明

## 修改现有 Python 脚本

将 `save_to_excel.py` 的输出目标改为 JSON 文件：

```python
import json
import pandas as pd
import os

# 1. 检查并读取 JSON 字符串
print(f"收到的数据类型: {type(json_str)}")
print(f"收到的数据长度: {len(str(json_str))}")
print(f"收到的数据前100字符: {str(json_str)[:100]}")

# 如果 json_str 已经是 list 或 dict，直接使用；否则解析
if isinstance(json_str, (list, dict)):
    data = json_str
elif isinstance(json_str, str):
    if not json_str or json_str.strip() == "":
        raise ValueError("json_str 是空字符串，请检查 JavaScript 代码是否正确返回数据")
    data = json.loads(json_str)
else:
    raise TypeError(f"json_str 类型错误: {type(json_str)}")

# 检查数据是否为空
if not data:
    raise ValueError("解析后的数据为空，请检查提取逻辑")

print(f"成功解析 {len(data)} 条记录")

# 2. 转换为 DataFrame（确保列顺序）
df = pd.DataFrame(data)
column_order = ["镜片套餐", "折射率", "日常价", "活动价"]
df = df[column_order]

# 3. 输出到 Excel（保留）
excel_path = os.path.expanduser("~/Desktop/卫光2.xlsx")
df.to_excel(excel_path, index=False, engine='openpyxl')
print(f"Excel已保存到: {excel_path}")

# 4. 输出到监控系统的 JSON 文件（新增）
json_output_path = "/home/hahahaha/SQLjiagejiankong/input/current_price.json"
os.makedirs(os.path.dirname(json_output_path), exist_ok=True)

with open(json_output_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"监控数据已保存到: {json_output_path}")
print(f"共 {len(df)} 行数据，列: {', '.join(df.columns.tolist())}")
```

## 工作流程

1. **影刀运行 JS 脚本** → 抓取天猫价格数据
2. **影刀运行 Python 脚本** → 同时生成 Excel 和 JSON
3. **Node.js 监控系统自动运行** → 检测价格变动

## 影刀配置建议

在影刀中添加步骤：
1. 执行 JavaScript 提取器（已有）
2. 执行 Python 脚本（已有）
3. **新增**：执行 Shell 命令
   ```bash
   cd /home/hahahaha/SQLjiagejiankong && node index.js
   ```

或者使用 Cron 定时任务，让监控系统独立运行。

## JSON 输出示例

`/home/hahahaha/SQLjiagejiankong/input/current_price.json`：

```json
[
  {
    "镜片套餐": "防蓝光镜片",
    "折射率": "1.56",
    "日常价": "128.00",
    "活动价": "99.00"
  },
  {
    "镜片套餐": "防蓝光镜片",
    "折射率": "1.60",
    "日常价": "158.00",
    "活动价": "119.00"
  }
]
```

## 注意事项

- Python 脚本和监控系统使用相同的 JSON 格式
- 列顺序必须一致：镜片套餐、折射率、日常价、活动价
- JSON 文件会被监控系统覆盖式读取（不影响历史数据）
