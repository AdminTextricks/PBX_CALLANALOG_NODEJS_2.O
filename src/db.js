const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config();

const env = process.env.NODE_ENV || "development";

const config = {
  development: {
    host: process.env.DEV_DB_HOST,
    port: process.env.DEV_DB_PORT,
    user: process.env.DEV_DB_USER,
    password: process.env.DEV_DB_PASSWORD,
    database: process.env.DEV_DB_NAME,
  },
  production: {
    host: process.env.PROD_DB_HOST,
    port: process.env.PROD_DB_PORT,
    user: process.env.PROD_DB_USER,
    password: process.env.PROD_DB_PASSWORD,
    database: process.env.PROD_DB_NAME,
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

const db = mysql.createConnection(dbConfig);

db.connect((err) => {
  if (err) {
    console.error("Error connecting to database:", err);
    return;
  }
  console.log("Connected to database!");
});

module.exports = db;
