// ================================================
// 价格监控系统 - 前端 JavaScript
// 接入真实 API + 完整错误处理
// ================================================

const API_BASE = '/api';
const REQUEST_TIMEOUT = 8000; // 8 秒超时

// 深色模式管理
class ThemeManager {
  constructor() {
    this.theme = this.getStoredTheme() || 'light';
    this.init();
  }

  init() {
    this.applyTheme(this.theme);
    this.setupToggle();
  }

  getStoredTheme() {
    try {
      return localStorage.getItem('theme');
    } catch (error) {
      console.warn('localStorage 不可用，使用默认主题');
      return null;
    }
  }

  setStoredTheme(theme) {
    try {
      localStorage.setItem('theme', theme);
    } catch (error) {
      console.warn('无法保存主题设置');
    }
  }

  applyTheme(theme) {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    this.theme = theme;
    this.setStoredTheme(theme);
  }

  toggle() {
    const newTheme = this.theme === 'light' ? 'dark' : 'light';
    this.applyTheme(newTheme);
  }

  setupToggle() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }
  }
}

// 带超时和错误处理的 fetch
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: 'UNKNOWN', message: `HTTP ${response.status}` };
      }
      throw new FetchError(errorData.message || errorData.error, response.status, errorData.error);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new FetchError('请求超时，请稍后重试', 408, 'TIMEOUT');
    }

    if (error instanceof FetchError) {
      throw error;
    }

    throw new FetchError('网络连接失败，请检查网络', 0, 'NETWORK_ERROR');
  }
}

class FetchError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.code = code;
  }
}

// 统计数据管理
class StatsManager {
  constructor() {
    this.productCountEl = document.getElementById('product-count');
    this.changesCountEl = document.getElementById('changes-count');
    this.lastUpdateEl = document.getElementById('last-update');
    this.animationTimers = new Map();
  }

  async fetchStats() {
    try {
      this.showLoading();
      const data = await fetchWithTimeout(`${API_BASE}/overview`);
      this.updateStats(data);
    } catch (error) {
      console.error('获取统计数据失败:', error);
      this.showError(error);
    }
  }

  showLoading() {
    if (this.productCountEl) this.productCountEl.textContent = '···';
    if (this.changesCountEl) this.changesCountEl.textContent = '···';
    if (this.lastUpdateEl) this.lastUpdateEl.textContent = '加载中...';
  }

  showError(error) {
    const message = error.code === 'TIMEOUT' ? '超时'
                  : error.code === 'NETWORK_ERROR' ? '网络错误'
                  : error.status === 503 ? '服务不可用'
                  : '加载失败';

    if (this.productCountEl) this.productCountEl.textContent = '-';
    if (this.changesCountEl) this.changesCountEl.textContent = '-';
    if (this.lastUpdateEl) {
      this.lastUpdateEl.textContent = message;
      this.lastUpdateEl.classList.add('text-red-500');
    }
  }

  updateStats(data) {
    if (this.lastUpdateEl) {
      this.lastUpdateEl.classList.remove('text-red-500');
    }

    if (this.productCountEl) {
      this.animateNumber(this.productCountEl, data.monitoredProductCount || 0);
    }

    if (this.changesCountEl) {
      if (!data.hasComparableData) {
        this.changesCountEl.textContent = '暂无';
      } else {
        this.animateNumber(this.changesCountEl, data.productsWithChanges || 0);
      }
    }

    if (this.lastUpdateEl) {
      if (data.latestRecordTime) {
        const formatted = this.formatDateTime(data.latestRecordTime);
        this.lastUpdateEl.textContent = formatted;
      } else {
        this.lastUpdateEl.textContent = '暂无数据';
      }
    }
  }

  animateNumber(element, target) {
    const key = element.id;
    if (this.animationTimers.has(key)) {
      clearInterval(this.animationTimers.get(key));
    }

    const current = parseInt(element.textContent) || 0;
    if (current === target) return;

    const duration = 500;
    const steps = 20;
    const increment = (target - current) / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      if (step >= steps) {
        element.textContent = target;
        clearInterval(timer);
        this.animationTimers.delete(key);
      } else {
        element.textContent = Math.round(current + increment * step);
      }
    }, duration / steps);

    this.animationTimers.set(key, timer);
  }

  formatDateTime(dateStr) {
    if (!dateStr) return '暂无数据';

    try {
      const date = new Date(dateStr.replace(' ', 'T'));
      const now = new Date();
      const diff = now - date;

      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes} 分钟前`;

      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours} 小时前`;

      const days = Math.floor(hours / 24);
      if (days < 7) return `${days} 天前`;

      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');

      return `${month}-${day} ${hour}:${minute}`;
    } catch (error) {
      console.error('日期格式化失败:', error);
      return dateStr;
    }
  }
}

// 商品列表管理
class ProductsManager {
  constructor() {
    this.productsContent = document.getElementById('products-content');
    this.changesContent = document.getElementById('changes-content');
    // 分开管理两个请求各自的 token，互不干扰
    this.productsToken = 0;
    this.changesToken = 0;
  }

  async fetch() {
    if (!this.productsContent) return;

    const token = ++this.productsToken;
    this.showLoading();

    try {
      const products = await fetchWithTimeout(`${API_BASE}/products`);

      if (token !== this.productsToken) return;

      if (!Array.isArray(products) || products.length === 0) {
        this.showEmpty();
        return;
      }

      this.render(products);
    } catch (error) {
      if (token !== this.productsToken) return;
      console.error('获取商品列表失败:', error);
      this.showError(error);
    }
  }

  async fetchChanges() {
    if (!this.changesContent) return;

    const token = ++this.changesToken;
    this.showChangesLoading();

    try {
      const overview = await fetchWithTimeout(`${API_BASE}/overview`);

      if (token !== this.changesToken) return;
      this.renderChanges(overview);
    } catch (error) {
      if (token !== this.changesToken) return;
      console.error('获取变化摘要失败:', error);
      this.showChangesError(error);
    }
  }

  showLoading() {
    this.productsContent.innerHTML = '<div class="py-8 text-apple-gray-400">加载中...</div>';
  }

  showEmpty() {
    this.productsContent.innerHTML = '<div class="py-8 text-apple-gray-400">暂无监控商品</div>';
  }

  showError(error) {
    const msg = this.getErrorMessage(error);
    this.productsContent.innerHTML = `<div class="py-8 text-red-500">${msg}</div>`;
  }

  getErrorMessage(error) {
    if (!error) return '未知错误';
    if (error.code === 'TIMEOUT') return '请求超时，请稍后重试';
    if (error.code === 'NETWORK_ERROR') return '网络连接失败';
    if (error.status === 503) return '服务不可用，数据库异常';
    return error.message || '加载失败';
  }

  showChangesLoading() {
    this.changesContent.innerHTML = '<div class="py-4 text-apple-gray-400">加载中...</div>';
  }

  showChangesError(error) {
    const msg = this.getErrorMessage(error);
    this.changesContent.innerHTML = `<div class="py-4 text-red-500">${msg}</div>`;
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  render(products) {
    const html = products.map(p => {
      // 与商品详情页一致：简称 → 页面标题前10字 → 商品 ID
      const name = this.escapeHtml(
        p.displayName || (p.pageTitle ? p.pageTitle.substring(0, 10) : null) || p.platformProductId || '未命名商品'
      );
      const shopInfo = `店铺：${this.escapeHtml(p.shopName || '-')}　货号：${this.escapeHtml(p.articleNumber || '-')}`;
      const platformId = this.escapeHtml(p.platformProductId || '未知');
      const skuCount = p.skuCount || 0;
      const increased = p.priceChanges ? p.priceChanges.increasedCount : 0;
      const decreased = p.priceChanges ? p.priceChanges.decreasedCount : 0;
      const latestTime = p.latestBatch ? this.escapeHtml(p.latestBatch.importedAt || '无记录') : '无记录';
      const status = p.latestBatch ? this.escapeHtml(p.latestBatch.status || '未知') : '无批次';

      const increasedHtml = increased > 0
        ? `<span class="text-red-500 font-semibold">↑ ${increased}</span>`
        : '<span class="text-apple-gray-400">↑ 0</span>';
      const decreasedHtml = decreased > 0
        ? `<span class="text-green-500 font-semibold">↓ ${decreased}</span>`
        : '<span class="text-apple-gray-400">↓ 0</span>';

      return `
        <div class="border-b border-apple-gray-200 dark:border-apple-gray-700 last:border-0 py-4 hover:bg-apple-gray-50 dark:hover:bg-apple-gray-700/30 transition-colors px-2 rounded-apple cursor-pointer" onclick="location.href='detail.html?id=${p.id}'">
          <div class="flex items-center justify-between gap-4 flex-wrap">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium">${name}</span>
                <span class="text-sm text-apple-gray-500">${shopInfo}</span>
              </div>
              <div class="text-sm text-apple-gray-400 mt-1">
                平台 ID: ${platformId} · ${skuCount} 个 SKU
              </div>
            </div>
            <div class="flex items-center gap-4 text-sm">
              <div class="flex gap-2">${increasedHtml} ${decreasedHtml}</div>
              <div class="text-apple-gray-500">${latestTime}</div>
              <svg class="w-4 h-4 text-apple-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.productsContent.innerHTML = html;
  }

  renderChanges(overview) {
    const summary = overview.priceChangeSummary || {};
    const increased = summary.increasedCount || 0;
    const decreased = summary.decreasedCount || 0;
    const newPromo = summary.newPromoCount || 0;
    const canceled = summary.canceledPromoCount || 0;

    const hasChanges = increased > 0 || decreased > 0 || newPromo > 0 || canceled > 0;

    if (!overview.hasComparableData) {
      this.changesContent.innerHTML = '<div class="py-4 text-apple-gray-400 text-center">暂无可比数据（仅有一次采集记录）</div>';
      return;
    }

    if (!hasChanges) {
      this.changesContent.innerHTML = '<div class="py-4 text-apple-gray-400 text-center">最新两批次活动价无超阈值变化</div>';
      return;
    }

    const items = [];
    if (increased > 0) items.push(`<span class="text-red-500 font-semibold">涨价 ${increased}</span>`);
    if (decreased > 0) items.push(`<span class="text-green-500 font-semibold">降价 ${decreased}</span>`);
    if (newPromo > 0) items.push(`<span class="text-orange-500 font-semibold">新增活动价 ${newPromo}</span>`);
    if (canceled > 0) items.push(`<span class="text-gray-500 font-semibold">取消活动价 ${canceled}</span>`);

    this.changesContent.innerHTML = `
      <div class="flex items-center gap-4 flex-wrap justify-center py-2">
        ${items.join('<span class="text-apple-gray-300">·</span>')}
      </div>
    `;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const themeManager = new ThemeManager();
  const statsManager = new StatsManager();
  const productsManager = new ProductsManager();

  statsManager.fetchStats();
  productsManager.fetch();
  productsManager.fetchChanges();

  setInterval(() => {
    statsManager.fetchStats();
    productsManager.fetch();
    productsManager.fetchChanges();
  }, 60000);
});
