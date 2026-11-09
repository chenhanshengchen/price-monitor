# 前端 Skills 使用指南 - 价格监控系统

## 📚 已下载的 Skills

你已经成功下载了以下两个 skills：

1. **ui-ux-pro-max** - UI/UX 设计智能助手
2. **senior-frontend** - 前端开发工具包

位置：`/home/hahahaha/.claude/.claude/skills/`

---

## 🎨 Skill 1: UI/UX Pro Max

### 这是什么？

一个**超级设计指南库**，包含：
- 🎨 **50+ 种 UI 风格**（玻璃态、极简主义、扁平化等）
- 🌈 **97 种配色方案**（按行业分类）
- ✍️ **57 种字体搭配**（Google Fonts）
- 📊 **25 种图表类型**
- ✅ **99 条 UX 最佳实践**
- 🛠️ **9 种技术栈**（React, Vue, Next.js, Tailwind 等）

### 核心功能

#### 1. 设计系统生成器 (必用！)

**作用**：根据你的项目类型，自动推荐完整的设计系统

**命令格式**：
```bash
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "<关键词>" --design-system -p "项目名称"
```

**示例**：
```bash
# 为价格监控系统生成设计系统
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "dashboard monitoring data visualization professional" --design-system -p "价格监控系统"
```

**会得到什么？**
- 推荐的 UI 风格（比如：Glassmorphism 玻璃态）
- 配色方案（主色、辅助色、背景色）
- 字体搭配（标题字体 + 正文字体）
- 页面布局模式
- 要避免的反模式

#### 2. 领域搜索

**作用**：查询特定领域的详细建议

| 领域 | 用途 | 示例关键词 |
|------|------|-----------|
| `product` | 产品类型推荐 | SaaS, dashboard, monitoring |
| `style` | UI 风格 | glassmorphism, minimalism, dark mode |
| `typography` | 字体搭配 | professional, modern, elegant |
| `color` | 配色方案 | fintech, saas, dashboard |
| `landing` | 页面结构 | hero, pricing, testimonial |
| `chart` | 图表类型 | trend, comparison, timeline |
| `ux` | UX 最佳实践 | animation, accessibility, loading |

**命令格式**：
```bash
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "<关键词>" --domain <领域>
```

**示例**：
```bash
# 查询图表推荐
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "price trend comparison" --domain chart

# 查询 UX 最佳实践
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "animation loading state" --domain ux
```

#### 3. 技术栈指南

**作用**：获取特定技术栈的最佳实践

**可用技术栈**：
- `html-tailwind` ← **推荐给你用这个**（简单、现代）
- `react` - React 性能优化
- `nextjs` - Next.js SSR
- `vue` - Vue 3 组合式 API
- `svelte` - Svelte 框架

**命令格式**：
```bash
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "<关键词>" --stack html-tailwind
```

**示例**：
```bash
# 获取 Tailwind CSS 响应式布局指南
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "responsive layout grid" --stack html-tailwind
```

### UX 检查清单

Skill 内置了优先级分类的 UX 规则：

#### 🔴 关键（必须遵守）

1. **无障碍访问**
   - 颜色对比度至少 4.5:1
   - 交互元素有明显的焦点状态
   - 图片有 alt 文本

2. **触摸和交互**
   - 按钮最小 44x44px
   - 点击元素显示 `cursor-pointer`
   - 加载时禁用按钮防止重复点击

#### 🟡 高优先级

3. **性能**
   - 图片使用 WebP 格式
   - 懒加载非首屏图片
   - 尊重用户的 `prefers-reduced-motion` 设置

4. **布局和响应式**
   - 移动端文字至少 16px
   - 固定导航栏不遮挡内容
   - 不出现横向滚动条

#### 🟢 中优先级

5. **排版和颜色**
   - 正文行高 1.5-1.75
   - 每行 65-75 个字符
   - 标题和正文字体要搭配

6. **动画**
   - 微交互 150-300ms
   - 使用 transform/opacity（性能好）
   - 显示加载状态（骨架屏或转圈）

### 常见错误检测

Skill 会帮你避免这些新手错误：

| 错误 | 正确做法 |
|------|---------|
| ❌ 用 emoji 当图标 🎨 | ✅ 用 SVG 图标（Heroicons, Lucide） |
| ❌ 玻璃效果在浅色模式太透明 | ✅ 浅色模式用 `bg-white/80` 以上 |
| ❌ 交互元素没有 hover 效果 | ✅ 加 `hover:bg-gray-100` 等反馈 |
| ❌ 深色文本在浅色背景对比不足 | ✅ 用 `text-slate-900` 而非 `text-gray-500` |
| ❌ 固定导航栏遮住内容 | ✅ 给内容区加 `padding-top` |

---

## 💻 Skill 2: Senior Frontend

### 这是什么？

一个**前端开发工具包**，专注于：
- React / Next.js 开发
- TypeScript
- Tailwind CSS
- 性能优化
- 组件最佳实践

### 核心功能

#### 1. 组件生成器

**作用**：快速生成标准化的 React 组件

**命令**：
```bash
python3 ~/.claude/.claude/skills/senior-frontend/scripts/component_generator.py <项目路径> [选项]
```

**注意**：这个 skill 的脚本是**模板**，实际使用时需要我（AI）根据你的需求来生成代码。

#### 2. Bundle 分析器

**作用**：分析打包文件大小，找出性能瓶颈

**命令**：
```bash
python3 ~/.claude/.claude/skills/senior-frontend/scripts/bundle_analyzer.py <目标路径> [--verbose]
```

#### 3. 前端脚手架

**作用**：快速搭建前端项目结构

**命令**：
```bash
python3 ~/.claude/.claude/skills/senior-frontend/scripts/frontend_scaffolder.py [参数] [选项]
```

### 参考文档

Skill 包含 3 个参考指南（虽然是模板，但提供了结构）：

1. **react_patterns.md** - React 模式和最佳实践
2. **nextjs_optimization_guide.md** - Next.js 优化指南
3. **frontend_best_practices.md** - 前端最佳实践

### 技术栈

支持的技术：
- **语言**：TypeScript, JavaScript
- **前端框架**：React, Next.js
- **样式**：Tailwind CSS
- **状态管理**：Context, Redux
- **构建工具**：Webpack, Vite

---

## 🎯 对你的价格监控系统有什么帮助？

### 你的系统需求分析

根据你的价格监控系统，需要展示：

1. **数据仪表盘**
   - 实时价格监控
   - 历史价格趋势图
   - 价格变动提醒

2. **功能需求**
   - 商品列表展示
   - 价格对比图表
   - 时间筛选器
   - 价格变动高亮

3. **技术需求**
   - 响应式设计（桌面 + 移动端）
   - 图表展示（Chart.js 或其他）
   - 深色/浅色模式切换
   - 数据刷新

### Skills 如何帮助你

| 需求 | 使用哪个 Skill | 如何帮助 |
|------|---------------|---------|
| **整体设计风格** | ui-ux-pro-max | 生成适合"数据监控仪表盘"的设计系统 |
| **配色方案** | ui-ux-pro-max | 推荐专业的仪表盘配色（深色/浅色） |
| **图表类型** | ui-ux-pro-max | 推荐价格趋势应该用什么图表 |
| **字体选择** | ui-ux-pro-max | 推荐易读的数据展示字体 |
| **UX 最佳实践** | ui-ux-pro-max | 检查加载状态、错误提示、交互反馈 |
| **组件结构** | senior-frontend | 提供 React 组件最佳实践（如果用 React） |
| **性能优化** | senior-frontend | 图表渲染优化、数据懒加载 |
| **响应式布局** | 两者都可以 | Tailwind CSS 响应式设计指南 |

---

## 📝 具体应该什么时候、怎么使用它们？

### 阶段 1：设计阶段（开始前端开发之前）

**目标**：确定设计风格、配色、字体、布局

#### 步骤 1：生成设计系统（必做！）

```bash
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "dashboard monitoring data visualization fintech professional" --design-system -p "价格监控系统"
```

**会得到**：
- 推荐的 UI 风格（比如：Minimalism + Glassmorphism）
- 配色方案（主色、辅助色、背景色）
- 字体搭配
- 页面布局建议

#### 步骤 2：查询图表推荐

```bash
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "price trend comparison timeline" --domain chart
```

**会得到**：
- 价格趋势用什么图表（折线图）
- 价格对比用什么图表（条形图）
- 推荐的图表库（Chart.js, Recharts, ECharts）

#### 步骤 3：查询 UX 最佳实践

```bash
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "loading animation data refresh" --domain ux
```

**会得到**：
- 数据加载时显示什么（骨架屏 vs 转圈）
- 刷新动画的最佳时长
- 错误提示的展示方式

#### 步骤 4：获取技术栈指南

```bash
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "responsive grid table chart" --stack html-tailwind
```

**会得到**：
- Tailwind CSS 响应式布局写法
- 表格在移动端的最佳实践
- 图表容器的响应式处理

---

### 阶段 2：开发阶段（写代码时）

**此时不需要手动运行命令！**

**为什么？**

因为我（Claude）已经读取了这两个 skills 的内容。当你说"帮我做前端"时，我会：

1. **自动应用 ui-ux-pro-max 的设计原则**
   - 选择合适的配色
   - 使用正确的字体大小
   - 添加合适的动画
   - 确保无障碍访问

2. **自动应用 senior-frontend 的最佳实践**
   - 组件结构清晰
   - 代码性能优化
   - TypeScript 类型安全
   - 响应式设计

**你只需要告诉我**：
```
"用 HTML + Tailwind CSS 给我做一个价格监控仪表盘，要有：
1. 顶部统计卡片（商品数、最新更新时间）
2. 价格趋势图表
3. 商品列表表格
4. 深色模式支持"
```

**我会**：
- 根据 ui-ux-pro-max 选择合适的设计风格
- 根据 senior-frontend 写出高质量代码
- 自动遵循 UX 最佳实践

---

### 阶段 3：审查阶段（代码写完后）

**目标**：检查 UI/UX 是否符合最佳实践

**你可以说**：
```
"用 ui-ux-pro-max skill 检查一下我的前端代码，看有没有 UX 问题"
```

**我会检查**：
- ❌ 有没有用 emoji 当图标
- ❌ 颜色对比度是否足够
- ❌ 按钮是否太小（移动端）
- ❌ hover 状态是否明显
- ❌ 加载状态是否有反馈
- ❌ 是否支持键盘导航
- ❌ 浅色模式是否可读

---

## 🎬 实战：为价格监控系统做前端的完整流程

### 第 1 步：告诉我你的需求

**你说**：
```
"我想重新做价格监控系统的前端，要求：
1. 现代化的设计，专业感
2. 显示价格趋势图表
3. 支持深色/浅色模式
4. 响应式，手机也能用
5. 用 HTML + Tailwind CSS（不用 React，越简单越好）"
```

### 第 2 步：我会自动使用 skills

**我会做这些**（你看不到，后台自动进行）：

1. 运行 `ui-ux-pro-max` 的设计系统生成器
2. 查询适合"数据仪表盘"的配色方案
3. 查询价格图表的最佳实践
4. 查询 `html-tailwind` 技术栈指南
5. 应用所有 UX 最佳实践规则

### 第 3 步：我会生成代码

**我会给你**：
- `index.html` - 页面结构
- `style.css` - 自定义样式（如果需要）
- `app.js` - 前端逻辑（图表、数据加载）
- `config.js` - 配置文件（API 地址等）

**代码会包含**：
- ✅ 符合设计系统的配色
- ✅ 正确的字体大小和行高
- ✅ 响应式布局（Tailwind CSS）
- ✅ 深色/浅色模式切换
- ✅ 加载状态和错误提示
- ✅ 无障碍访问（ARIA 标签）
- ✅ 性能优化（图片懒加载、防抖等）

### 第 4 步：我会创建新的后端 API

**因为数据库结构改了**，所以也会更新：
- `web-ui-v2.js` - 新的后端服务
  - 读取新的 `price_history_v2` 表
  - 使用新的 `products` 表
  - 提供优化的 API 接口

### 第 5 步：你测试和反馈

**你启动服务**：
```bash
node web-ui-v2.js
# 访问 http://localhost:3000
```

**你可以说**：
```
"价格图表太小了，能放大一点吗？"
"深色模式的文字看不清，能调整一下吗？"
"能加一个筛选器，只看价格变动的商品吗？"
```

**我会调整**并再次应用 skills 的最佳实践。

---

## 📋 Skills 命令速查表

### ui-ux-pro-max

```bash
# 1. 生成完整设计系统（最重要！）
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "dashboard monitoring fintech" --design-system -p "项目名"

# 2. 查询配色方案
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "saas dashboard" --domain color

# 3. 查询图表类型
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "trend comparison" --domain chart

# 4. 查询 UX 最佳实践
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "loading animation" --domain ux

# 5. 查询字体搭配
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "professional modern" --domain typography

# 6. 获取技术栈指南
python3 ~/.claude/.claude/skills/ui-ux-pro-max/scripts/search.py "responsive grid" --stack html-tailwind
```

### senior-frontend

```bash
# 1. 生成组件
python3 ~/.claude/.claude/skills/senior-frontend/scripts/component_generator.py <项目路径>

# 2. 分析打包文件
python3 ~/.claude/.claude/skills/senior-frontend/scripts/bundle_analyzer.py .

# 3. 搭建项目
python3 ~/.claude/.claude/skills/senior-frontend/scripts/frontend_scaffolder.py
```

---

## 💡 最佳实践建议

### 什么时候手动运行 skill 命令？

**需要手动运行**的情况：
1. **你想自己看设计建议** - 运行 `--design-system` 查看完整设计系统
2. **你想探索不同风格** - 多次运行查询不同的设计风格
3. **你想学习 UX 知识** - 查看 `--domain ux` 学习最佳实践

**不需要手动运行**的情况：
1. **让我直接做前端** - 我会自动应用 skills
2. **让我审查代码** - 我会自动检查 UX 问题
3. **日常开发** - 我已经记住了 skills 的内容

### 推荐的工作流程

**方式 1：信任我（推荐，最快）**
```
你："帮我做价格监控的前端，要现代、专业、支持深色模式"
我：[自动应用两个 skills，生成代码]
你：测试，给反馈
我：根据反馈调整
```

**方式 2：先看设计建议，再让我做**
```
你：自己运行 --design-system 查看设计建议
你："我喜欢 Glassmorphism 风格，用这个做前端"
我：按你选择的风格生成代码
```

**方式 3：边做边查**
```
你："帮我做前端"
我：生成第一版代码
你：运行 --domain ux 查看 UX 最佳实践
你："能加上骨架屏加载效果吗？"
我：添加并优化
```

---

## 🎯 总结：对你的帮助

| 你的需求 | Skills 如何帮助 | 具体效果 |
|---------|----------------|---------|
| **不知道用什么风格** | ui-ux-pro-max 推荐适合"监控仪表盘"的设计风格 | 专业、现代、易读 |
| **配色不知道怎么选** | 自动推荐配色方案（深色/浅色） | 对比度足够，好看不累眼 |
| **图表不知道用哪种** | 推荐价格趋势用折线图，对比用条形图 | 数据展示清晰直观 |
| **不知道字体大小** | 自动应用排版最佳实践 | 移动端易读，桌面端舒适 |
| **不知道如何响应式** | Tailwind CSS 响应式指南 | 手机、平板、桌面都好用 |
| **担心 UX 问题** | 自动检查 99 条 UX 规则 | 避免新手错误 |
| **性能优化不会做** | senior-frontend 提供优化建议 | 加载快、不卡顿 |
| **代码结构不清晰** | 自动应用前端最佳实践 | 代码易读易维护 |

---

## 🚀 下一步：开始做前端！

**现在你可以说**：

```
"用 ui-ux-pro-max 和 senior-frontend 这两个 skills，
帮我重新做价格监控系统的前端。

要求：
1. 现代化设计，专业感（适合数据仪表盘）
2. 顶部显示统计信息（商品数、SKU数、最新更新时间）
3. 价格趋势图表（可以选择时间范围）
4. 商品列表表格（显示价格变动）
5. 支持深色/浅色模式切换
6. 响应式设计（手机也能用）
7. 用 HTML + Tailwind CSS + Chart.js（简单点，不用 React）

先帮我运行 --design-system 看看推荐什么设计风格。"
```

**或者直接说**：

```
"直接帮我做吧，你自己选最合适的设计风格！"
```

---

**文档生成时间**: 2026-10-31
**Skills 位置**: `/home/hahahaha/.claude/.claude/skills/`
