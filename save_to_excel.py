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
    # 检查是否是空字符串
    if not json_str or json_str.strip() == "":
        raise ValueError("json_str 是空字符串，请检查 JavaScript 代码是否正确返回数据")
    data = json.loads(json_str)
else:
    raise TypeError(f"json_str 类型错误: {type(json_str)}")

# 检查数据是否为空
if not data:
    raise ValueError("解析后的数据为空，请检查提取逻辑")

print(f"成功解析 {len(data)} 条记录")

# 2. 转换为 DataFrame（确保列顺序：镜片套餐、折射率、日常价、活动价）
df = pd.DataFrame(data)
column_order = ["镜片套餐", "折射率", "日常价", "活动价"]
df = df[column_order]

# 3. 保存为 Excel 文件
excel_path = os.path.expanduser("~/Desktop/卫光2.xlsx")
df.to_excel(excel_path, index=False, engine='openpyxl')
print(f"Excel已保存到: {excel_path}")

# 4. 输出 JSON 到监控系统
# 兼容 Windows 和 WSL 路径
json_path = r"\\wsl.localhost\Ubuntu\home\hahahaha\SQLjiagejiankong\input\current_price.json"
os.makedirs(os.path.dirname(json_path), exist_ok=True)

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"监控JSON已保存到: {json_path}")
print(f"共 {len(df)} 行数据，列: {', '.join(df.columns.tolist())}")
