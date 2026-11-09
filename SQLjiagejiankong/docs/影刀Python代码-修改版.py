import json
import pandas as pd
import os
import subprocess

# 1. 检查并读取 JSON 字符串
print(f"收到的数据类型: {type(json_str)}")
print(f"收到的数据长度: {len(str(json_str))}")
print(f"收到的数据前100字符: {str(json_str)[:100]}")

# 如果 json_str 已经是 list 或 dict,直接使用;否则解析
if isinstance(json_str, (list, dict)):
    data = json_str
elif isinstance(json_str, str):
    # 检查是否是空字符串
    if not json_str or json_str.strip() == "":
        raise ValueError("json_str 是空字符串,请检查 JavaScript 代码是否正确返回数据")
    data = json.loads(json_str)
else:
    raise TypeError(f"json_str 类型错误: {type(json_str)}")

# 检查数据是否为空
if not data:
    raise ValueError("解析后的数据为空,请检查提取逻辑")

# 2. 提取商品信息和 SKU 数组
# 新格式: {itemId, title, url, skus: [...]}
if isinstance(data, dict) and 'skus' in data:
    # 新格式
    item_id = data.get('itemId', 'unknown')
    title = data.get('title', '未知商品')
    skus = data.get('skus', [])
    print(f"[新格式] 商品ID: {item_id}, 标题: {title}, SKU数量: {len(skus)}")

    category_names = data.get('categoryNames') or {}
    stats = data.get('stats') or {}
    print(f"分类 A: {category_names.get('A', '')}, 分类 B: {category_names.get('B', '')}")
    print(f"统计: {stats}")

    # 价格冲突或结构错误属于校验失败，不写文件、不触发导入
    conflicts = data.get('conflicts') or []
    errors = data.get('errors') or []
    if conflicts or errors:
        for c in conflicts:
            print(f"[价格冲突] {json.dumps(c, ensure_ascii=False)}")
        for e in errors:
            print(f"[结构错误] {json.dumps(e, ensure_ascii=False)}")
        raise ValueError(f"校验失败: 价格冲突 {len(conflicts)} 条, 结构错误 {len(errors)} 条, 已停止导入")
elif isinstance(data, list):
    # 旧格式兼容（纯数组，默认归属到蔡司）
    item_id = '563795984293'
    title = '蔡司'
    skus = data
    print(f"[旧格式] 自动归属到商品ID: {item_id}, SKU数量: {len(skus)}")
else:
    raise ValueError("数据格式错误: 既不是新格式对象也不是旧格式数组")

# 检查 SKU 是否为空
if not skus:
    raise ValueError("SKU 数据为空,请检查提取逻辑")

print(f"成功解析 {len(skus)} 条 SKU 记录")

# 3. 转换为 DataFrame(确保列顺序:镜片套餐、折射率、日常价、活动价)
df = pd.DataFrame(skus)
column_order = ["镜片套餐", "折射率", "日常价", "活动价"]
df = df[column_order]

# 4. 保存为 Excel 文件（按商品 ID 命名）
excel_filename = f"price_{item_id}.xlsx"
excel_path = os.path.expanduser(f"~/Desktop/{excel_filename}")
df.to_excel(excel_path, index=False, engine='openpyxl')
print(f"Excel已保存到: {excel_path}")

# 5. 输出 JSON 到监控系统（按商品 ID 命名）
json_filename = f"price_{item_id}.json"
json_path = rf"C:\temp\{json_filename}"
os.makedirs(os.path.dirname(json_path), exist_ok=True)

# 保存完整的新格式（包含 itemId/title/url/skus）
with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(data if isinstance(data, dict) else {
        'itemId': item_id,
        'title': title,
        'url': '',
        'skus': skus
    }, f, ensure_ascii=False, indent=2)

print(f"监控JSON已保存到: {json_path}")

# 6. 自动触发 WSL 导入
wsl_json_path = f"/mnt/c/temp/{json_filename}"
# 先加载 NVM 环境变量，再执行 node 命令
wsl_command = f'source ~/.nvm/nvm.sh && cd /home/hahahaha/SQLjiagejiankong && node index.js --file {wsl_json_path}'

print(f"正在触发 WSL 导入...")
print(f"WSL 命令: {wsl_command}")

try:
    result = subprocess.run(
        ['wsl.exe', '-e', 'bash', '-c', wsl_command],
        capture_output=True,
        text=True,
        encoding='utf-8',
        timeout=30
    )

    print("\n=== WSL 导入输出 ===")
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print("错误输出:")
        print(result.stderr)

    if result.returncode == 0:
        print(f"✓ 导入成功! 商品 {item_id} 的价格数据已写入数据库")
    else:
        print(f"✗ 导入失败，退出码: {result.returncode}")

except subprocess.TimeoutExpired:
    print("✗ WSL 命令执行超时（30秒）")
except Exception as e:
    print(f"✗ 调用 WSL 时发生异常: {e}")

print(f"\n汇总:")
print(f"- 商品ID: {item_id}")
print(f"- 商品标题: {title}")
print(f"- SKU数量: {len(df)}")
print(f"- Excel: {excel_path}")
print(f"- JSON: {json_path}")
