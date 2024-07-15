const mysql = require("mysql2");

// const db = mysql.createConnection({
//   host: "92.204.162.221",
//   port: "19645",
//   user: "StgcalanLg",
//   password: "9RWlG_ZBd`h",
//   database: "pbx_callanalog",
// });

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "pbx_callanalog",
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to database:", err);
    return;
  }
  console.log("Connected to database!");
});

module.exports = db;
