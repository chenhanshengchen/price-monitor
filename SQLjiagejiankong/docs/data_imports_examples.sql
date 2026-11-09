-- ============================================
-- data_imports 表使用示例
-- ============================================

-- 示例数据：
/*
| id | import_time          | source      | record_count | status  | error_message |
|----|---------------------|-------------|--------------|---------|---------------|
| 1  | 2026-10-24 03:05:13 | yingdao_rpa | 68           | success | NULL          |
| 2  | 2026-10-25 02:32:02 | yingdao_rpa | 68           | success | NULL          |
| 3  | 2026-10-25 05:13:51 | yingdao_rpa | 68           | success | NULL          |
| 4  | 2026-10-25 05:31:08 | yingdao_rpa | 68           | success | NULL          |
| 5  | 2026-10-25 08:00:00 | yingdao_rpa | 0            | failed  | JSON parse error |
*/

-- ============================================
-- 使用场景 1：查看最近的导入任务
-- ============================================
SELECT
  import_time,
  record_count,
  status
FROM data_imports
ORDER BY import_time DESC
LIMIT 10;

-- ============================================
-- 使用场景 2：统计成功率
-- ============================================
SELECT
  DATE(import_time) as date,
  COUNT(*) as total_runs,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_runs,
  ROUND(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate
FROM data_imports
WHERE import_time >= datetime('now', '-7 days')
GROUP BY DATE(import_time);

-- ============================================
-- 使用场景 3：追踪某次导入的数据
-- ============================================
-- 查找导入任务
SELECT * FROM data_imports WHERE id = 3;

-- 查询该次导入的所有价格数据
SELECT
  p.package_name,
  ph.daily_price,
  ph.promo_price
FROM price_history_v2 ph
JOIN products p ON ph.product_id = p.id
WHERE ph.import_id = 3;

-- ============================================
-- 使用场景 4：检测异常
-- ============================================
-- 找出导入数量异常的任务
SELECT *
FROM data_imports
WHERE record_count < 50  -- 正常应该是 68-83 个 SKU
   OR status != 'success'
ORDER BY import_time DESC;

-- ============================================
-- 使用场景 5：数据质量监控
-- ============================================
-- 最近一周每天的平均导入数量
SELECT
  DATE(import_time) as date,
  AVG(record_count) as avg_records,
  MIN(record_count) as min_records,
  MAX(record_count) as max_records
FROM data_imports
WHERE import_time >= datetime('now', '-7 days')
  AND status = 'success'
GROUP BY DATE(import_time);
