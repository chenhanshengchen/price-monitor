const fs = require('fs');
const path = require('path');
const config = require('../config');

class Logger {
  constructor() {
    this.logsDir = config.paths.logs;
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  getLogFileName() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logsDir, `monitor_${date}.log`);
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] [${level}] ${message}`;
    if (data) {
      logMsg += ` ${JSON.stringify(data)}`;
    }
    return logMsg;
  }

  log(level, message, data = null) {
    const logFile = this.getLogFileName();
    const logMsg = this.formatMessage(level, message, data);
    fs.appendFileSync(logFile, logMsg + '\n');
    console.log(logMsg);
  }

  info(message, data = null) {
    this.log('INFO', message, data);
  }

  error(message, data = null) {
    this.log('ERROR', message, data);
  }
}

module.exports = new Logger();
