let currentChart = null;
let currentProduct = null;
let currentQueryTime = null;
let availableDates = [];
let priceChangeThreshold = 0;

const FETCH_TIMEOUT = 10000; // 10秒超时

async function fetchJSON(url, options = {}) {
  const timeout = options.timeout || FETCH_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    console.log('[Frontend] Fetching:', url);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('[Frontend] HTTP error:', response.status, url);
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch (e) {
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('[Frontend] Non-JSON response:', contentType, url);
      const text = await response.text();
      console.error('[Frontend] Response body:', text.substring(0, 500));
      throw new Error('服务器返回了非JSON响应');
    }

    const data = await response.json();
    console.log('[Frontend] Success:', url, data);
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('[Frontend] Timeout:', url);
      throw new Error(`请求超时(${timeout}ms): ${url}`);
    }
    console.error('[Frontend] Fetch error:', url, error);
    throw error;
  }
}

function formatPrice(price) {
  if (price === null || price === undefined || price === '') {
    return '—';
  }
  return `¥${price}`;
}

function formatDateTime(datetime) {
  if (!datetime) return '—';
  return datetime.replace('T', ' ').substring(0, 19);
}

function formatDate(datetime) {
  if (!datetime) return '—';
  return datetime.substring(0, 10);
}

function formatTime(datetime) {
  if (!datetime) return '—';
  return datetime.substring(11, 19);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showLoading(elementId, message = '加载中...') {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<div class="loading-state">${escapeHtml(message)}</div>`;
  }
}

function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
  }
}

async function loadStats() {
  try {
    console.log('[Frontend] Loading stats...');
    const stats = await fetchJSON('/api/stats');
    document.getElementById('product-count').textContent = stats.product_count;
    document.getElementById('sku-count').textContent = stats.sku_count;
    document.getElementById('last-update').textContent = formatDateTime(stats.last_update);
    priceChangeThreshold = stats.price_change_threshold || 0;
    console.log('[Frontend] Stats loaded successfully');
  } catch (error) {
    console.error('[Frontend] Failed to load stats:', error);
    document.getElementById('product-count').textContent = '—';
    document.getElementById('sku-count').textContent = '—';
    document.getElementById('last-update').textContent = '加载失败';
  }
}

async function loadAvailableDates() {
  const dateSelect = document.getElementById('date-select');

  try {
    console.log('[Frontend] Loading available dates...');
    showLoading('sku-list', '正在加载日期列表...');

    const dates = await fetchJSON('/api/query-times');
    availableDates = dates;

    if (dates.length === 0) {
      dateSelect.innerHTML = '<option value="">无可用数据</option>';
      showError('sku-list', '暂无可用数据');
      return;
    }

    dateSelect.innerHTML = dates.map(d => {
      const date = d.date || formatDate(d.latest_time);
      return `<option value="${date}">${date}</option>`;
    }).join('');

    const todayDate = new Date().toISOString().substring(0, 10);
    const todayOption = Array.from(dateSelect.options).find(opt => opt.value === todayDate);

    if (todayOption) {
      dateSelect.value = todayDate;
    } else {
      dateSelect.selectedIndex = 0;
    }

    console.log('[Frontend] Dates loaded, now loading times for selected date');
    await loadTimesForDate(dateSelect.value);
  } catch (error) {
    console.error('[Frontend] Failed to load dates:', error);
    dateSelect.innerHTML = '<option value="">加载失败</option>';
    showError('sku-list', `加载日期失败: ${error.message}`);
  }
}

async function loadTimesForDate(date) {
  if (!date) {
    console.warn('[Frontend] loadTimesForDate called with empty date');
    return;
  }

  try {
    console.log('[Frontend] Loading times for date:', date);
    showLoading('sku-list', '正在加载时间列表...');

    const times = await fetchJSON(`/api/query-times?date=${date}`);
    const timeSelector = document.getElementById('time-selector');
    const timeSelect = document.getElementById('time-select');

    if (!timeSelector || !timeSelect) {
      console.error('[Frontend] time-selector or time-select element not found');
      showError('sku-list', 'DOM元素未找到');
      return;
    }

    if (times.length === 0) {
      timeSelector.style.display = 'none';
      showError('sku-list', `${date} 无可用数据`);
      return;
    }

    if (times.length === 1) {
      timeSelector.style.display = 'none';
      console.log('[Frontend] Single time found, loading products');
      await loadProducts(date, times[0].record_time);
    } else {
      timeSelector.style.display = 'block';
      timeSelect.innerHTML = times.map(t => {
        const time = t.record_time;
        return `<option value="${time}">${formatTime(time)}</option>`;
      }).join('');

      console.log('[Frontend] Multiple times found, loading products for latest');
      await loadProducts(date, times[0].record_time);
    }
  } catch (error) {
    console.error('[Frontend] Failed to load times:', error);
    showError('sku-list', `加载时间失败: ${error.message}`);
  }
}

async function loadProducts(date, recordTime) {
  const productInfo = document.getElementById('product-info');
  const skuList = document.getElementById('sku-list');

  try {
    console.log('[Frontend] Loading products:', { date, recordTime });
    showLoading('sku-list', '正在加载商品数据...');
    showLoading('product-info', '加载中...');

    let url = `/api/products?date=${date}`;
    if (recordTime) {
      url += `&record_time=${encodeURIComponent(recordTime)}`;
    }

    const data = await fetchJSON(url);
    currentProduct = data;
    currentQueryTime = data.query_time;

    const productInfoHTML = `
      <div class="info-row">
        <span class="label">品牌:</span>
        <span>${escapeHtml(data.brand)}</span>
      </div>
      <div class="info-row">
        <span class="label">商品链接:</span>
        <a href="${escapeHtml(data.product_url)}" target="_blank">${escapeHtml(data.product_url)}</a>
      </div>
      <div class="info-row">
        <span class="label">商品 ID:</span>
        <span>${escapeHtml(data.product_id)}</span>
      </div>
    `;
    productInfo.innerHTML = productInfoHTML;

    renderSkuList(data.skus);

    console.log('[Frontend] Products loaded, now loading comparison');
    await loadComparison(date, recordTime);
  } catch (error) {
    console.error('[Frontend] Failed to load products:', error);
    showError('product-info', `加载失败: ${error.message}`);
    showError('sku-list', `加载失败: ${error.message}`);
  }
}

function renderSkuList(skus) {
  const container = document.getElementById('sku-list');

  if (skus.length === 0) {
    container.innerHTML = '<div class="empty-state">当天暂无数据</div>';
    return;
  }

  const html = skus.map(sku => {
    const packageName = sku.package_name || '未知套餐';
    const refraction = sku.refraction || '';
    const promoPrice = sku.promo_price ? formatPrice(sku.promo_price) : '无活动价';

    return `
      <div class="sku-item">
        <div class="sku-name">${escapeHtml(packageName)}</div>
        <div class="sku-details">
          ${refraction ? `<span>折射率: ${escapeHtml(refraction)}</span>` : ''}
          <span class="promo">活动价: ${promoPrice}</span>
        </div>
        <div class="sku-details">
          <span style="font-size: 11px; color: #999;">${formatDateTime(sku.record_time)}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  console.log('[Frontend] Rendered', skus.length, 'SKUs');
}

async function loadComparison(date, recordTime) {
  const chartInfo = document.getElementById('chart-info');
  const chartContainer = document.getElementById('chart-container');

  if (!chartInfo || !chartContainer) {
    console.error('[Frontend] chart-info or chart-container element not found');
    return;
  }

  try {
    console.log('[Frontend] Loading comparison:', { date, recordTime });
    chartContainer.innerHTML = '<div class="loading-state">正在加载价格对比...</div>';

    let url = `/api/comparison?date=${date}`;
    if (recordTime) {
      url += `&record_time=${encodeURIComponent(recordTime)}`;
    }

    const comparison = await fetchJSON(url);

    if (!comparison.current_time) {
      chartInfo.style.display = 'none';
      chartContainer.innerHTML = '<div class="empty-state">当天暂无数据</div>';
      console.log('[Frontend] No current_time in comparison');
      return;
    }

    if (!comparison.previous_time) {
      chartInfo.style.display = 'none';
      chartContainer.innerHTML = '<div class="empty-state">无可比较的历史数据</div>';
      console.log('[Frontend] No previous_time in comparison');
      return;
    }

    const comparisonText = document.getElementById('comparison-text');
    if (!comparisonText) {
      console.error('[Frontend] comparison-text element not found');
      return;
    }

    if (comparison.items.length === 0) {
      chartInfo.style.display = 'block';
      comparisonText.textContent =
        `对比 ${formatDateTime(comparison.previous_time)} 与 ${formatDateTime(comparison.current_time)}，无活动价变化超过 ¥${comparison.threshold} 的 SKU`;
      chartContainer.innerHTML = '<div class="empty-state">无超过阈值的价格变化</div>';
      console.log('[Frontend] No price changes above threshold');
      return;
    }

    chartInfo.style.display = 'block';
    comparisonText.textContent =
      `对比 ${formatDateTime(comparison.previous_time)} 与 ${formatDateTime(comparison.current_time)}，发现 ${comparison.items.length} 个活动价变化超过 ¥${comparison.threshold} 的 SKU`;

    console.log('[Frontend] Rendering comparison chart with', comparison.items.length, 'items');
    renderComparisonChart(comparison);
  } catch (error) {
    console.error('[Frontend] Failed to load comparison:', error);
    chartInfo.style.display = 'none';
    chartContainer.innerHTML = `<div class="error-message">加载对比失败: ${escapeHtml(error.message)}</div>`;
  }
}

function renderComparisonChart(comparison) {
  const container = document.getElementById('chart-container');
  container.innerHTML = '<canvas id="price-chart"></canvas>';

  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }

  const ctx = document.getElementById('price-chart').getContext('2d');

  const labels = comparison.items.map(item => {
    const pkg = item.package_name.length > 15 ? item.package_name.substring(0, 15) + '...' : item.package_name;
    return `${pkg} ${item.refraction}`;
  });

  const changeValues = comparison.items.map(item => item.change_value);
  const backgroundColors = comparison.items.map(item =>
    item.change_type === 'increased' ? 'rgba(244, 67, 54, 0.8)' : 'rgba(76, 175, 80, 0.8)'
  );

  currentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '活动价变化 (¥)',
        data: changeValues,
        backgroundColor: backgroundColors,
        borderColor: backgroundColors.map(c => c.replace('0.8', '1')),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              const item = comparison.items[context[0].dataIndex];
              return `${item.package_name} ${item.refraction}`;
            },
            label: function(context) {
              const item = comparison.items[context.dataIndex];
              const lines = [
                `上次活动价: ¥${item.previous_promo_price.toFixed(2)}`,
                `本次活动价: ¥${item.current_promo_price.toFixed(2)}`,
                `变动: ¥${item.change_value.toFixed(2)}`,
              ];
              if (item.change_percent !== null) {
                lines.push(`变动率: ${item.change_percent.toFixed(2)}%`);
              }
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: '价格变化 (¥)'
          },
          ticks: {
            callback: function(value) {
              return '¥' + value.toFixed(0);
            }
          }
        },
        y: {
          ticks: {
            font: {
              size: 11
            }
          }
        }
      }
    }
  });

  console.log('[Frontend] Chart rendered successfully');
}

document.getElementById('date-select').addEventListener('change', async (e) => {
  const date = e.target.value;
  console.log('[Frontend] Date changed:', date);
  if (date) {
    await loadTimesForDate(date);
  }
});

document.getElementById('time-select').addEventListener('change', async (e) => {
  const recordTime = e.target.value;
  const date = document.getElementById('date-select').value;
  console.log('[Frontend] Time changed:', recordTime);
  if (date && recordTime) {
    await loadProducts(date, recordTime);
  }
});

function initializeApp() {
  console.log('[Frontend] Initializing app...');

  const requiredElements = [
    'product-count', 'sku-count', 'last-update',
    'date-select', 'time-selector', 'time-select',
    'sku-list', 'product-info',
    'chart-info', 'chart-container', 'comparison-text'
  ];

  const missingElements = requiredElements.filter(id => !document.getElementById(id));

  if (missingElements.length > 0) {
    console.error('[Frontend] Missing required elements:', missingElements);
    const skuList = document.getElementById('sku-list');
    if (skuList) {
      skuList.innerHTML = `<div class="error-message">页面初始化失败: 缺少必要的DOM元素</div>`;
    }
    return;
  }

  Promise.all([
    loadStats(),
    loadAvailableDates()
  ]).then(() => {
    console.log('[Frontend] App initialized successfully');
  }).catch(error => {
    console.error('[Frontend] Initialization error:', error);
    showError('sku-list', `初始化失败: ${error.message}`);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
