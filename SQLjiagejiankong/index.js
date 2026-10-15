const PriceMonitor = require('./src/priceMonitor');

async function main() {
  const monitor = new PriceMonitor();
  await monitor.run();
}

main().catch(error => {
  console.error('程序执行失败:', error.message);
  process.exit(1);
});
