const fs = require('fs');

// 先写临时文件再重命名替换，读取方不会读到写了一半的数据库文件
function writeFileAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* 临时文件可能不存在 */ }
    throw err;
  }
}

module.exports = { writeFileAtomic };
