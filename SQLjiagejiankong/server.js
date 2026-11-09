const express = require('express');
const path = require('path');
const { createRouter } = require('./src/api');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 10000; // 10 秒超时

// 请求超时中间件：超过 10 秒未响应则返回 503
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({
        error: 'REQUEST_TIMEOUT',
        message: '请求处理超时，请稍后重试'
      });
    }
  }, REQUEST_TIMEOUT_MS);

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS（本地开发）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// API 路由
const apiRouter = createRouter(config.paths.database);
app.use('/api', apiRouter);

// 全局 404（非 /api 路由）
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `路径 ${req.path} 不存在` });
});

// 全局错误处理：捕获路由中未被处理的异常
app.use((err, req, res, next) => {
  console.error('[Server] 未处理的异常:', err.message, err.stack);
  if (!res.headersSent) {
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '服务器内部错误，请查看日志'
    });
  }
});

// 启动服务器，处理端口占用
const server = app.listen(PORT, () => {
  console.log(`\n=== 价格监控 Web 服务已启动 ===`);
  console.log(`本地访问: http://localhost:${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/api/health\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${PORT} 已被占用`);
    console.error(`   请先运行: kill $(lsof -t -i:${PORT})`);
    console.error(`   或者换一个端口: PORT=3001 node server.js\n`);
  } else {
    console.error('服务器启动失败:', err.message);
  }
  process.exit(1);
});

// 未捕获的 Promise rejection
process.on('unhandledRejection', (reason) => {
  console.error('[Server] 未捕获的 Promise 异常:', reason);
});

// 未捕获的同步异常（最后一道防线，记录后退出）
process.on('uncaughtException', (err) => {
  console.error('[Server] 未捕获的同步异常:', err.message, err.stack);
  process.exit(1);
});
