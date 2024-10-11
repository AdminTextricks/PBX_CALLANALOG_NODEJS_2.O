const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config();

const env = process.env.NODE_ENV || "production";

const config = {
  development: {
    host: process.env.DEV_DB_HOST,
    port: process.env.DEV_DB_PORT,
    user: process.env.DEV_DB_USER,
    password: process.env.DEV_DB_PASSWORD,
    database: process.env.DEV_DB_NAME,
    timezone: "Z",
  },
  production: {
    host: process.env.PROD_DB_HOST,
    port: process.env.PROD_DB_PORT,
    user: process.env.PROD_DB_USER,
    password: process.env.PROD_DB_PASSWORD,
    database: process.env.PROD_DB_NAME,
    timezone: "Z",
  },
  local: {
    host: process.env.LOCAL_DB_HOST,
    user: process.env.LOCAL_DB_USER,
    password: process.env.LOCAL_DB_PASSWORD,
    database: process.env.LOCAL_DB_NAME,
  },
};

// Select the configuration based on the current environment
const dbConfig = config[env];

const db = mysql.createPool(dbConfig);

// Error handling for the pool
db.on("error", (err) => {
  console.error("Database error:", err);
});

module.exports = db;
