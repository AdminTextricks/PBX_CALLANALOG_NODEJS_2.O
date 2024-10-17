// logger.js
const winston = require('winston');

// Create a logger instance
const logger = winston.createLogger({
  level: 'info', // Log levels (info, warn, error, etc.)
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json() // Log in JSON format
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }), // Error logs
    new winston.transports.File({ filename: 'combined.log' }) // All logs
  ]
});

// If we're in development, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple() // Log simple format to console
  }));
}

module.exports = logger;
