const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "bot.log");

// Asegurar que exista el directorio
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function writeLine(level, msg) {
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
}

const logger = {
  info: (msg) => writeLine("INFO", msg),
  warn: (msg) => writeLine("WARN", msg),
  error: (msg) => writeLine("ERROR", msg),
};

module.exports = logger;
