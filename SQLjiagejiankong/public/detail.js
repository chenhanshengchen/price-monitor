// ================================================
// 商品详情页 JavaScript
// ================================================

const API_BASE = '/api';
const REQUEST_TIMEOUT = 8000;

// 从 URL 获取商品 ID
function getProductId() {
  const params = new URLSearchParams(window.location.search);
  const id = parseInt(params.get('id'), 10);
  if (!id || id < 1) {
    showError('无效的商品 ID');
    return null;
  }
  return id;
}

// 深色模式管理（复用）
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
    } catch {
      return null;
    }
  }

  setStoredTheme(theme) {
    try {
      localStorage.setItem('theme', theme);
    } catch {}
  }

  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
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

// 带超时的 fetch
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
      throw new FetchError('请求超时', 408, 'TIMEOUT');
    }

    if (error instanceof FetchError) {
      throw error;
    }

    throw new FetchError('网络连接失败', 0, 'NETWORK_ERROR');
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

// 商品信息管理
class ProductInfoManager {
  constructor(productId) {
    this.productId = productId;
    this.container = document.getElementById('product-info-content');
    this.titleEl = document.getElementById('page-title');
    this.onSettingsChange = null;  // 阈值变化时的回调
  }

  async fetch() {
    if (!this.container) return;

    this.showLoading();

    try {
      const product = await fetchWithTimeout(`${API_BASE}/products/${this.productId}`);
      this.render(product);
    } catch (error) {
      console.error('获取商品信息失败:', error);
      this.showError(error);
    }
  }

  showLoading() {
    this.container.innerHTML = '<div class="py-4 text-apple-gray-400">加载中...</div>';
  }

  showError(error) {
    const msg = this.getErrorMessage(error);
    this.container.innerHTML = `<div class="py-4 text-red-500">${msg}</div>`;
  }

  getErrorMessage(error) {
    if (!error) return '未知错误';
    if (error.status === 404) return '商品不存在';
    if (error.code === 'TIMEOUT') return '请求超时';
    if (error.code === 'NETWORK_ERROR') return '网络连接失败';
    if (error.status === 503) return '服务不可用';
    return error.message || '加载失败';
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  render(product) {
    // 展示优先级: display_name → page_title（前10字）→ platform_product_id
    const displayName = product.displayName;
    const pageTitle = product.pageTitle;
    const platformId = product.platformProductId || '';

    const defaultName = displayName
      || (pageTitle ? pageTitle.substring(0, 10) : null)
      || platformId
      || '未命名商品';

    const name = this.escapeHtml(defaultName);
    const shopInfo = `店铺：${this.escapeHtml(product.shopName || '-')}　货号：${this.escapeHtml(product.articleNumber || '-')}`;
    const platformIdEscaped = this.escapeHtml(platformId);
    const pageTitleEscaped = this.escapeHtml(pageTitle || '');
    const url = this.escapeHtml(product.productUrl || '');
    const threshold = product.priceThreshold != null ? product.priceThreshold : 5;
    const skuCount = product.skuCount || 0;

    if (this.titleEl) {
      this.titleEl.textContent = name;
    }

    this.container.innerHTML = `
      <div class="grid gap-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold">${name}</h3>
            <p class="text-sm text-apple-gray-500 mt-1">${shopInfo}</p>
          </div>
          <div class="text-right flex items-center gap-3">
            <div>
              <div class="text-sm text-apple-gray-500">价格阈值</div>
              <div class="text-2xl font-semibold text-apple-blue" id="threshold-display">¥${threshold}</div>
              <div class="text-xs text-apple-gray-400 mt-1">仅显示活动价绝对变动大于此值的 SKU</div>
            </div>
            <button id="edit-threshold-btn" class="p-2 rounded-xl bg-apple-gray-100 dark:bg-apple-gray-700 hover:bg-apple-gray-200 dark:hover:bg-apple-gray-600 transition-colors cursor-pointer" aria-label="编辑价格阈值">
              <svg class="w-4 h-4 text-apple-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        </div>
        <div class="flex gap-4 items-center text-sm text-apple-gray-600 dark:text-apple-gray-400 flex-wrap">
          <div class="flex items-center gap-2">
            <span>简称:</span>
            <span id="display-name-display" class="font-medium">${displayName ? this.escapeHtml(displayName) : '<span class="text-apple-gray-400">未设置</span>'}</span>
            <button id="edit-display-name-btn" class="p-1.5 rounded-lg bg-apple-gray-100 dark:bg-apple-gray-700 hover:bg-apple-gray-200 dark:hover:bg-apple-gray-600 transition-colors cursor-pointer" aria-label="编辑商品简称">
              <svg class="w-3.5 h-3.5 text-apple-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
          ${pageTitleEscaped ? `<span>·</span><span class="text-apple-gray-400 text-xs" title="采集时的页面标题">页面标题: ${pageTitleEscaped.substring(0, 20)}${pageTitleEscaped.length > 20 ? '...' : ''}</span>` : ''}
          <span>·</span>
          <div class="flex items-center gap-2">
            <span>商品 ID:</span>
            <span id="platform-id-display" class="font-medium">${platformIdEscaped || '未设置'}</span>
            <button id="edit-platform-id-btn" class="p-1.5 rounded-lg bg-apple-gray-100 dark:bg-apple-gray-700 hover:bg-apple-gray-200 dark:hover:bg-apple-gray-600 transition-colors cursor-pointer" aria-label="编辑商品 ID">
              <svg class="w-3.5 h-3.5 text-apple-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
          <span>·</span>
          <span title="历史累计 SKU 总数（含历次批次出现过的全部规格）">${skuCount} 个 SKU（历史累计）</span>
          ${url ? `<span>·</span><a href="${url}" target="_blank" class="text-apple-blue hover:underline">查看商品</a>` : ''}
        </div>
      </div>
    `;

    // 绑定编辑按钮事件
    const editThresholdBtn = document.getElementById('edit-threshold-btn');
    if (editThresholdBtn) {
      editThresholdBtn.addEventListener('click', () => this.showThresholdEditor(threshold));
    }

    const editDisplayNameBtn = document.getElementById('edit-display-name-btn');
    if (editDisplayNameBtn) {
      editDisplayNameBtn.addEventListener('click', () => this.showDisplayNameEditor(displayName || ''));
    }

    const editPlatformIdBtn = document.getElementById('edit-platform-id-btn');
    if (editPlatformIdBtn) {
      editPlatformIdBtn.addEventListener('click', () => this.showPlatformIdEditor(platformId));
    }
  }

  // 显示价格阈值编辑器（内联弹出）
  showThresholdEditor(currentThreshold) {
    const existing = document.getElementById('threshold-editor');
    if (existing) existing.remove();

    const display = document.getElementById('threshold-display');
    if (!display) return;

    const editorHtml = document.createElement('div');
    editorHtml.id = 'threshold-editor';
    editorHtml.className = 'mt-3 p-4 bg-apple-gray-50 dark:bg-apple-gray-700/50 rounded-apple';
    editorHtml.innerHTML = `
      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm font-medium">活动价变动阈值</label>
        <input type="number" id="threshold-input" min="0" step="0.01" value="${currentThreshold}"
          class="w-24 px-3 py-1.5 rounded-xl bg-white dark:bg-apple-gray-800 border-0 focus:ring-2 focus:ring-apple-blue text-center">
        <span class="text-sm text-apple-gray-500">元</span>
        <div class="flex gap-2 ml-auto">
          <button id="threshold-cancel" class="px-4 py-1.5 text-sm rounded-xl bg-apple-gray-200 dark:bg-apple-gray-600 hover:bg-apple-gray-300 dark:hover:bg-apple-gray-500 transition-colors">取消</button>
          <button id="threshold-save" class="px-4 py-1.5 text-sm rounded-xl bg-apple-blue text-white hover:bg-blue-600 transition-colors">保存</button>
        </div>
      </div>
      <div id="threshold-error" class="text-red-500 text-sm mt-2 hidden"></div>
    `;

    display.parentElement.appendChild(editorHtml);

    const input = document.getElementById('threshold-input');
    const saveBtn = document.getElementById('threshold-save');
    const cancelBtn = document.getElementById('threshold-cancel');
    const errorEl = document.getElementById('threshold-error');

    if (input) input.focus();

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const value = input.value.trim();
        errorEl.classList.add('hidden');

        const num = parseFloat(value);
        if (value === '' || isNaN(num)) {
          errorEl.textContent = '请输入有效数字';
          errorEl.classList.remove('hidden');
          return;
        }
        if (num < 0) {
          errorEl.textContent = '阈值不能为负数';
          errorEl.classList.remove('hidden');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
          await this.saveSettings({ price_threshold: num });
          editorHtml.remove();
          // 重新加载商品信息和价格对比
          await this.fetch();
          if (this.onSettingsChange) this.onSettingsChange();
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
          errorEl.textContent = err.message || '保存失败';
          errorEl.classList.remove('hidden');
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => editorHtml.remove());
    }
  }

  // 显示商品简称编辑器
  showDisplayNameEditor(currentName) {
    const existing = document.getElementById('display-name-editor');
    if (existing) existing.remove();

    const display = document.getElementById('display-name-display');
    if (!display) return;

    const editorHtml = document.createElement('div');
    editorHtml.id = 'display-name-editor';
    editorHtml.className = 'mt-2 p-4 bg-apple-gray-50 dark:bg-apple-gray-700/50 rounded-apple';
    editorHtml.innerHTML = `
      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm font-medium">商品简称</label>
        <input type="text" id="display-name-input" value="${this.escapeHtml(currentName)}" maxlength="100" placeholder="留空则使用页面标题或商品ID"
          class="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-white dark:bg-apple-gray-800 border-0 focus:ring-2 focus:ring-apple-blue">
        <div class="flex gap-2">
          <button id="display-name-cancel" class="px-4 py-1.5 text-sm rounded-xl bg-apple-gray-200 dark:bg-apple-gray-600 hover:bg-apple-gray-300 dark:hover:bg-apple-gray-500 transition-colors">取消</button>
          <button id="display-name-save" class="px-4 py-1.5 text-sm rounded-xl bg-apple-blue text-white hover:bg-blue-600 transition-colors">保存</button>
        </div>
      </div>
      <div class="text-xs text-apple-gray-500 mt-2">简称用于列表和详情页显示，留空时系统自动使用页面标题（前10字）或商品ID</div>
      <div id="display-name-error" class="text-red-500 text-sm mt-2 hidden"></div>
    `;

    display.parentElement.appendChild(editorHtml);

    const input = document.getElementById('display-name-input');
    const saveBtn = document.getElementById('display-name-save');
    const cancelBtn = document.getElementById('display-name-cancel');
    const errorEl = document.getElementById('display-name-error');

    if (input) {
      input.focus();
      input.select();
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const value = input.value.trim();
        errorEl.classList.add('hidden');

        if (value.length > 100) {
          errorEl.textContent = '商品简称不能超过 100 字符';
          errorEl.classList.remove('hidden');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
          await this.saveSettings({ display_name: value || null });
          editorHtml.remove();
          await this.fetch();
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
          errorEl.textContent = err.message || '保存失败';
          errorEl.classList.remove('hidden');
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => editorHtml.remove());
    }
  }

  // 显示商品 ID 编辑器
  showPlatformIdEditor(currentId) {
    const existing = document.getElementById('platform-id-editor');
    if (existing) existing.remove();

    const display = document.getElementById('platform-id-display');
    if (!display) return;

    const editorHtml = document.createElement('div');
    editorHtml.id = 'platform-id-editor';
    editorHtml.className = 'mt-2 p-4 bg-apple-gray-50 dark:bg-apple-gray-700/50 rounded-apple';
    editorHtml.innerHTML = `
      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm font-medium">商品 ID</label>
        <input type="text" id="platform-id-input" value="${currentId}" maxlength="100"
          class="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-white dark:bg-apple-gray-800 border-0 focus:ring-2 focus:ring-apple-blue">
        <div class="flex gap-2">
          <button id="platform-id-cancel" class="px-4 py-1.5 text-sm rounded-xl bg-apple-gray-200 dark:bg-apple-gray-600 hover:bg-apple-gray-300 dark:hover:bg-apple-gray-500 transition-colors">取消</button>
          <button id="platform-id-save" class="px-4 py-1.5 text-sm rounded-xl bg-apple-blue text-white hover:bg-blue-600 transition-colors">保存</button>
        </div>
      </div>
      <div id="platform-id-error" class="text-red-500 text-sm mt-2 hidden"></div>
    `;

    display.parentElement.appendChild(editorHtml);

    const input = document.getElementById('platform-id-input');
    const saveBtn = document.getElementById('platform-id-save');
    const cancelBtn = document.getElementById('platform-id-cancel');
    const errorEl = document.getElementById('platform-id-error');

    if (input) {
      input.focus();
      input.select();
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const value = input.value;
        errorEl.classList.add('hidden');

        // 商品 ID 允许空字符串（清空），但必须是字符串
        if (value.length > 100) {
          errorEl.textContent = '商品 ID 不能超过 100 字符';
          errorEl.classList.remove('hidden');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
          await this.saveSettings({ platform_product_id: value });
          editorHtml.remove();
          // 重新加载商品信息
          await this.fetch();
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
          errorEl.textContent = err.message || '保存失败';
          errorEl.classList.remove('hidden');
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => editorHtml.remove());
    }
  }

  // 调用后端 PATCH 接口保存设置
  async saveSettings(settings) {
    const response = await fetchWithTimeout(`${API_BASE}/products/${this.productId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (!response.success) {
      throw new Error(response.message || response.error || '保存失败');
    }

    return response;
  }
}

// 批次管理
class BatchManager {
  constructor(productId) {
    this.productId = productId;
    this.container = document.getElementById('batch-selector-content');
    this.batches = [];
    this.currentBatchId = null;
    this.previousBatchId = null;
    this.onBatchChange = null;
  }

  async fetch() {
    if (!this.container) return;

    this.showLoading();

    try {
      const batches = await fetchWithTimeout(`${API_BASE}/products/${this.productId}/batches`);

      if (!Array.isArray(batches) || batches.length === 0) {
        this.showEmpty();
        return;
      }

      this.batches = batches;

      // 默认选择最新两个批次
      if (batches.length >= 2) {
        this.currentBatchId = batches[0].id;
        this.previousBatchId = batches[1].id;
      } else if (batches.length === 1) {
        this.currentBatchId = batches[0].id;
        this.previousBatchId = null;
      }

      this.render();

      // 触发初始加载
      if (this.onBatchChange) {
        this.onBatchChange(this.currentBatchId, this.previousBatchId);
      }
    } catch (error) {
      console.error('获取批次列表失败:', error);
      this.showError(error);
    }
  }

  showLoading() {
    this.container.innerHTML = '<div class="py-4 text-apple-gray-400">加载中...</div>';
  }

  showEmpty() {
    this.container.innerHTML = '<div class="py-4 text-apple-gray-400">暂无批次数据</div>';
  }

  showError(error) {
    const msg = error.code === 'TIMEOUT' ? '请求超时'
              : error.code === 'NETWORK_ERROR' ? '网络连接失败'
              : error.status === 503 ? '服务不可用'
              : error.message || '加载失败';
    this.container.innerHTML = `<div class="py-4 text-red-500">${msg}</div>`;
  }

  render() {
    if (this.batches.length === 0) {
      this.showEmpty();
      return;
    }

    const options = this.batches.map(b => {
      const time = b.importedAt || '未知时间';
      const status = b.status === 'success' ? '成功' : b.status === 'failed' ? '失败' : '导入中';
      const count = b.insertedRecordCount || b.sourceRecordCount || 0;
      return `<option value="${b.id}">${time} (${status}, ${count} 条)</option>`;
    }).join('');

    this.container.innerHTML = `
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-2">本次批次</label>
          <select id="current-batch" class="w-full px-4 py-2 rounded-xl bg-apple-gray-100 dark:bg-apple-gray-700 border-0 focus:ring-2 focus:ring-apple-blue">
            ${options}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">对比批次</label>
          <select id="previous-batch" class="w-full px-4 py-2 rounded-xl bg-apple-gray-100 dark:bg-apple-gray-700 border-0 focus:ring-2 focus:ring-apple-blue">
            <option value="">无对比</option>
            ${options}
          </select>
        </div>
      </div>
    `;

    const currentSelect = document.getElementById('current-batch');
    const previousSelect = document.getElementById('previous-batch');

    if (currentSelect) {
      currentSelect.value = this.currentBatchId;
      currentSelect.addEventListener('change', () => {
        this.currentBatchId = parseInt(currentSelect.value, 10);
        if (this.onBatchChange) {
          this.onBatchChange(this.currentBatchId, this.previousBatchId);
        }
      });
    }

    if (previousSelect && this.previousBatchId) {
      previousSelect.value = this.previousBatchId;
      previousSelect.addEventListener('change', () => {
        const val = previousSelect.value;
        this.previousBatchId = val ? parseInt(val, 10) : null;
        if (this.onBatchChange) {
          this.onBatchChange(this.currentBatchId, this.previousBatchId);
        }
      });
    }
  }
}

// SKU 表格管理
class SkuTableManager {
  constructor(productId) {
    this.productId = productId;
    this.container = document.getElementById('sku-table-content');
    this.filterBar = document.getElementById('filter-bar');
    this.searchInput = document.getElementById('sku-search');
    this.clearSearchBtn = document.getElementById('clear-search');
    this.searchResultInfo = document.getElementById('search-result-info');

    this.currentFilter = 'exceeded';  // 默认选中"超阈值"
    this.searchKeyword = '';
    this.lastData = null;              // 保存最近一次 API 返回，供筛选切换时复用
    this.requestToken = 0;             // 取消过期请求，避免旧结果覆盖新结果
  }

  async fetch(currentBatchId, previousBatchId) {
    if (!this.container) return;

    // 保存最近一次批次 ID，供重试按钮使用
    this.lastCurrentBatchId = currentBatchId;
    this.lastPreviousBatchId = previousBatchId;

    const token = ++this.requestToken;
    this.showLoading();

    try {
      const url = previousBatchId
        ? `${API_BASE}/products/${this.productId}/comparison?current_batch_id=${currentBatchId}&previous_batch_id=${previousBatchId}`
        : `${API_BASE}/products/${this.productId}/comparison?current_batch_id=${currentBatchId}`;

      const data = await fetchWithTimeout(url);

      // 忽略过期请求的结果（快速切换批次时）
      if (token !== this.requestToken) return;

      this.lastData = data;
      // hasComparison 以 API 实际返回的 previousBatchId 为准，不以前端参数为准
      const hasComparison = data.previousBatchId != null;
      this.render(data, hasComparison);
    } catch (error) {
      if (token !== this.requestToken) return;
      console.error('获取 SKU 数据失败:', error);
      this.showError(error);
    }
  }

  showLoading() {
    if (this.container) {
      this.container.innerHTML = '<div class="py-8 text-apple-gray-400 text-center">加载中...</div>';
    }
    if (this.filterBar) this.filterBar.classList.add('hidden');
  }

  showError(error) {
    const msg = error.code === 'TIMEOUT' ? '请求超时'
              : error.code === 'NETWORK_ERROR' ? '网络连接失败'
              : error.status === 503 ? '服务不可用'
              : error.message || '加载失败';
    if (this.container) {
      this.container.innerHTML = `
        <div class="py-8 text-center">
          <div class="text-red-500 mb-3">${this.escapeHtml(msg)}</div>
          <button id="retry-btn" class="px-4 py-2 text-sm rounded-xl bg-apple-blue text-white hover:bg-blue-600 transition-colors">重试</button>
        </div>
      `;
      const retryBtn = document.getElementById('retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => this.fetch(this.lastCurrentBatchId, this.lastPreviousBatchId));
      }
    }
    if (this.filterBar) this.filterBar.classList.add('hidden');
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // 格式化价格展示：null 显示"无活动价"，有效价格显示 ¥金额
  formatPromoPrice(promoPrice) {
    if (promoPrice === null || promoPrice === undefined) return '<span class="text-apple-gray-400">无活动价</span>';
    return `¥${this.escapeHtml(promoPrice)}`;
  }

  // 获取变动状态的中文描述
  getChangeStatus(changeType, currentPromo, previousPromo, priceChange) {
    switch (changeType) {
      case 'no_promo':
        return '<span class="text-apple-gray-400">无活动价</span>';
      case 'new_promo':
        return '<span class="text-orange-500 font-medium">新增活动价</span>';
      case 'promo_canceled':
        return '<span class="text-apple-gray-500 font-medium">活动价取消</span>';
      case 'increased':
        return `<span class="text-red-500 font-semibold">↑ ¥${Math.abs(priceChange).toFixed(2)}</span>`;
      case 'decreased':
        return `<span class="text-green-500 font-semibold">↓ ¥${Math.abs(priceChange).toFixed(2)}</span>`;
      case 'unchanged':
        return '<span class="text-apple-gray-400">无变化</span>';
      default:
        return '<span class="text-apple-gray-400">-</span>';
    }
  }

  // 计算各筛选标签的数量（基于 API 返回的 summary）
  getFilterCounts(data) {
    const s = data.summary || {};
    const exceeded = (s.increased || 0) + (s.decreased || 0);
    const all = data.skus ? data.skus.length : 0;
    return {
      exceeded,
      increased: s.increased || 0,
      decreased: s.decreased || 0,
      all
    };
  }

  // 根据当前筛选和搜索关键词过滤 SKU
  filterSkus(skus, filter, keyword) {
    let filtered = skus;

    // 按筛选标签过滤
    if (filter === 'exceeded') {
      filtered = filtered.filter(s => s.changeType === 'increased' || s.changeType === 'decreased');
    } else if (filter === 'increased') {
      filtered = filtered.filter(s => s.changeType === 'increased');
    } else if (filter === 'decreased') {
      filtered = filtered.filter(s => s.changeType === 'decreased');
    }
    // filter === 'all' 时不做类型过滤

    // 按搜索关键词过滤
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      filtered = filtered.filter(s => {
        const pkg = (s.packageName || '').toLowerCase();
        const ref = (s.refraction || '').toLowerCase();
        return pkg.includes(lowerKeyword) || ref.includes(lowerKeyword);
      });
    }

    // 超阈值和涨价、降价按变动金额绝对值降序排列
    if (filter === 'exceeded' || filter === 'increased' || filter === 'decreased') {
      filtered = filtered.slice().sort((a, b) => {
        const aAbs = Math.abs(a.priceChange || 0);
        const bAbs = Math.abs(b.priceChange || 0);
        return bAbs - aAbs;
      });
    }

    return filtered;
  }

  // 渲染筛选标签栏
  renderFilterBar(data) {
    if (!this.filterBar) return;

    const counts = this.getFilterCounts(data);

    // 更新数量
    document.querySelectorAll('.filter-count').forEach(el => {
      const type = el.getAttribute('data-count');
      if (counts[type] !== undefined) {
        el.textContent = counts[type];
      }
    });

    // 更新按钮激活状态
    document.querySelectorAll('.filter-btn').forEach(btn => {
      const filter = btn.getAttribute('data-filter');
      if (filter === this.currentFilter) {
        btn.className = 'filter-btn px-4 py-2 rounded-xl text-sm font-medium transition-all bg-apple-blue text-white';
      } else {
        btn.className = 'filter-btn px-4 py-2 rounded-xl text-sm font-medium transition-all bg-apple-gray-100 dark:bg-apple-gray-700 hover:bg-apple-gray-200 dark:hover:bg-apple-gray-600';
      }
    });

    this.filterBar.classList.remove('hidden');
    this.renderPushButton(data, counts.exceeded);
  }

  // 推送按钮只在选定了两个批次时显示；推送的就是当前"超阈值"标签里的 SKU
  renderPushButton(data, exceededCount) {
    const btn = document.getElementById('push-exceeded-btn');
    const resultEl = document.getElementById('push-result');
    if (!btn) return;

    const hasComparison = data.previousBatchId != null;
    btn.classList.toggle('hidden', !hasComparison);
    btn.disabled = exceededCount === 0 || this.pushing;
    btn.title = exceededCount === 0 ? '当前对比没有超阈值的 SKU' : '';

    // 切换批次或阈值后，上一次推送结果不再对应当前对比
    const key = `${data.currentBatchId}-${data.previousBatchId}-${data.priceThreshold}`;
    if (this.pushResultKey !== key && resultEl) {
      resultEl.classList.add('hidden');
    }

    if (this._pushEventBound) return;
    this._pushEventBound = true;
    btn.addEventListener('click', () => this.pushExceeded());
  }

  setPushResult(message, ok) {
    const resultEl = document.getElementById('push-result');
    if (!resultEl) return;
    resultEl.textContent = message;
    resultEl.className = `text-sm ${ok ? 'text-green-600' : 'text-red-500'}`;
  }

  async pushExceeded() {
    const data = this.lastData;
    if (!data || data.previousBatchId == null || this.pushing) return;

    const exceededCount = this.getFilterCounts(data).exceeded;
    const confirmed = window.confirm(
      `将把本次对比中 ${exceededCount} 个涨跌超过 ¥${data.priceThreshold} 阈值的 SKU 推送到钉钉群，确定发送吗？`
    );
    if (!confirmed) return;

    const btn = document.getElementById('push-exceeded-btn');
    this.pushing = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '推送中...';
    }
    this.pushResultKey = `${data.currentBatchId}-${data.previousBatchId}-${data.priceThreshold}`;

    try {
      const result = await fetchWithTimeout(`${API_BASE}/products/${this.productId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_batch_id: data.currentBatchId,
          previous_batch_id: data.previousBatchId
        })
      }, 15000); // 服务端调用钉钉最多 8 秒，留出余量以便显示真实失败原因
      this.setPushResult(result.message, result.sent);
    } catch (error) {
      this.setPushResult(`推送失败：${error.message || '未知错误'}`, false);
    } finally {
      this.pushing = false;
      if (btn) {
        btn.textContent = '推送超阈值 SKU 到钉钉';
        btn.disabled = this.getFilterCounts(this.lastData).exceeded === 0;
      }
    }
  }

  // 绑定筛选按钮事件（只需绑定一次）
  setupFilterEvents() {
    if (this._filterEventsBound) return;
    this._filterEventsBound = true;

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentFilter = btn.getAttribute('data-filter');
        if (this.lastData) {
          this.render(this.lastData, !!this.lastData.previousBatchId);
        }
      });
    });

    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => {
        this.searchKeyword = this.searchInput.value.trim();
        if (this.clearSearchBtn) {
          this.clearSearchBtn.classList.toggle('hidden', !this.searchKeyword);
        }
        if (this.lastData) {
          this.render(this.lastData, !!this.lastData.previousBatchId);
        }
      });
    }

    if (this.clearSearchBtn) {
      this.clearSearchBtn.addEventListener('click', () => {
        this.searchKeyword = '';
        if (this.searchInput) this.searchInput.value = '';
        this.clearSearchBtn.classList.add('hidden');
        if (this.lastData) {
          this.render(this.lastData, !!this.lastData.previousBatchId);
        }
      });
    }
  }

  // 渲染空状态提示
  renderEmptyState(data, hasComparison) {
    const threshold = data.priceThreshold != null ? data.priceThreshold : 0;
    let message = '';
    let showAllBtn = false;

    if (!hasComparison) {
      message = '暂无可用的对比批次';
    } else {
      const counts = this.getFilterCounts(data);
      const hasComparablePromo = data.skus && data.skus.some(s =>
        s.currentPromoPrice !== null || s.previousPromoPrice !== null
      );

      if (!hasComparablePromo) {
        message = '当前两个批次暂无可比较的活动价数据';
      } else if (this.currentFilter === 'exceeded' && counts.exceeded === 0) {
        message = `本次对比没有超过 ¥${threshold} 阈值的活动价变化`;
        showAllBtn = true;
      } else if (this.currentFilter === 'increased' && counts.increased === 0) {
        message = `本次对比没有超过 ¥${threshold} 阈值的涨价 SKU`;
        showAllBtn = true;
      } else if (this.currentFilter === 'decreased' && counts.decreased === 0) {
        message = `本次对比没有超过 ¥${threshold} 阈值的降价 SKU`;
        showAllBtn = true;
      } else if (this.searchKeyword) {
        message = '没有匹配的 SKU';
      }
    }

    if (this.container) {
      this.container.innerHTML = `
        <div class="py-8 text-center">
          <div class="text-apple-gray-400 mb-3">${this.escapeHtml(message)}</div>
          ${showAllBtn ? '<button id="view-all-btn" class="px-4 py-2 text-sm rounded-xl bg-apple-gray-100 dark:bg-apple-gray-700 hover:bg-apple-gray-200 dark:hover:bg-apple-gray-600 transition-colors">查看全部 SKU</button>' : ''}
        </div>
      `;
      if (showAllBtn) {
        const viewAllBtn = document.getElementById('view-all-btn');
        if (viewAllBtn) {
          viewAllBtn.addEventListener('click', () => {
            this.currentFilter = 'all';
            if (this.lastData) {
              this.render(this.lastData, !!this.lastData.previousBatchId);
            }
          });
        }
      }
    }
  }

  render(data, hasComparison) {
    if (!this.container) return;

    this.setupFilterEvents();

    const allSkus = data.skus || [];

    // 渲染筛选栏
    this.renderFilterBar(data);

    // 无对比批次时
    if (!hasComparison) {
      this.renderEmptyState(data, false);
      return;
    }

    // 按当前筛选和搜索过滤
    const filteredSkus = this.filterSkus(allSkus, this.currentFilter, this.searchKeyword);

    // 更新搜索结果信息
    if (this.searchKeyword && this.searchResultInfo) {
      const allCountInFilter = this.filterSkus(allSkus, this.currentFilter, '').length;
      this.searchResultInfo.textContent = `在当前筛选中找到 ${filteredSkus.length} / ${allCountInFilter} 个 SKU`;
      this.searchResultInfo.classList.remove('hidden');
    } else if (this.searchResultInfo) {
      this.searchResultInfo.classList.add('hidden');
    }

    // 空状态
    if (filteredSkus.length === 0) {
      this.renderEmptyState(data, hasComparison);
      return;
    }

    // 渲染表格
    const headers = hasComparison
      ? '<th class="px-4 py-3 text-left">A</th><th class="px-4 py-3 text-left">B</th><th class="px-4 py-3 text-right">对比批次活动价</th><th class="px-4 py-3 text-right">本次活动价</th><th class="px-4 py-3 text-right">变动金额</th>'
      : '<th class="px-4 py-3 text-left">A</th><th class="px-4 py-3 text-left">B</th><th class="px-4 py-3 text-right">活动价</th>';

    const rows = filteredSkus.map(sku => {
      const pkg = this.escapeHtml(sku.packageName || '-');
      const refraction = this.escapeHtml(sku.refraction || '-');
      const current = this.formatPromoPrice(sku.currentPromoPrice);

      if (!hasComparison) {
        return `<tr class="border-t border-apple-gray-200 dark:border-apple-gray-700"><td class="px-4 py-3">${pkg}</td><td class="px-4 py-3">${refraction}</td><td class="px-4 py-3 text-right">${current}</td></tr>`;
      }

      const previous = this.formatPromoPrice(sku.previousPromoPrice);
      const changeHtml = this.getChangeStatus(sku.changeType, sku.currentPromoPrice, sku.previousPromoPrice, sku.priceChange);

      return `<tr class="border-t border-apple-gray-200 dark:border-apple-gray-700"><td class="px-4 py-3">${pkg}</td><td class="px-4 py-3">${refraction}</td><td class="px-4 py-3 text-right">${previous}</td><td class="px-4 py-3 text-right">${current}</td><td class="px-4 py-3 text-right">${changeHtml}</td></tr>`;
    }).join('');

    this.container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-apple-gray-50 dark:bg-apple-gray-700/50">
            <tr>${headers}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }
}

// 全局错误处理
function showError(message) {
  const main = document.querySelector('main');
  if (main) {
    main.innerHTML = `
      <div class="max-w-2xl mx-auto text-center py-16">
        <div class="text-red-500 text-xl font-semibold mb-4">${message}</div>
        <button onclick="history.back()" class="px-6 py-2 bg-apple-blue text-white rounded-xl hover:bg-blue-600 transition-colors">
          返回列表
        </button>
      </div>
    `;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const productId = getProductId();
  if (!productId) return;

  // 返回按钮：有来源且同源才回退，否则跳首页
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      const referrer = document.referrer;
      const sameOrigin = referrer && new URL(referrer, window.location.href).origin === window.location.origin;
      if (sameOrigin && history.length > 1) {
        history.back();
      } else {
        location.href = './index.html';
      }
    });
  }

  const themeManager = new ThemeManager();
  const productInfo = new ProductInfoManager(productId);
  const batchManager = new BatchManager(productId);
  const skuTable = new SkuTableManager(productId);

  // 批次选择变化时更新表格
  batchManager.onBatchChange = (currentId, previousId) => {
    skuTable.fetch(currentId, previousId);
  };

  // 阈值变化时重新加载当前批次的价格对比
  productInfo.onSettingsChange = () => {
    if (batchManager.currentBatchId) {
      skuTable.fetch(batchManager.currentBatchId, batchManager.previousBatchId);
    }
  };

  // 初始加载
  productInfo.fetch();
  batchManager.fetch();
});
