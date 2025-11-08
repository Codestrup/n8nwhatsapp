// utils/logger.js
import chalk from "chalk";

export const log = {
  info: (msg, ...args) => console.log(chalk.cyanBright("[INFO]"), msg, ...args),
  success: (msg, ...args) => console.log(chalk.greenBright("[SUCCESS]"), msg, ...args),
  warn: (msg, ...args) => console.log(chalk.yellowBright("[WARN]"), msg, ...args),
  error: (msg, ...args) => console.log(chalk.redBright("[ERROR]"), msg, ...args),
};
