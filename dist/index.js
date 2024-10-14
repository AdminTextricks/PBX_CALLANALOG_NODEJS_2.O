const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");
const connection = require("./db");
const crypto = require("crypto");
const app = express();
const fs = require('fs');
const bodyParser = require("body-parser");
app.use(bodyParser.json());

// Development>>>>>>>>>>>>>>>>
// const http = require("http");
// const server = http.createServer(app);
// const wss = new WebSocket.Server({ server });

// Production>>>>>>>>>>>>>>>>>>

const https = require("https");
const options = {
  cert: fs.readFileSync("/etc/letsencrypt/live/socket.callanalog.com-0004/fullchain.pem"),
  // Path to SSL certificate
  key: fs.readFileSync("/etc/letsencrypt/live/socket.callanalog.com-0004/privkey.pem") // Path to SSL key
  //ca: fs.readFileSync("/etc/letsencrypt/live/socket.callanalog.com/chain.pem")
};
const server = https.createServer(options, app);
const wss = new WebSocket.Server({
  server
});

// Enable CORS
app.use(cors({
  origin: process.env.CORS_FRONTEND_URL,
  credentials: true
}));
function generateHash(data) {
  // Ensure data is an array
  if (!Array.isArray(data)) {
    return null; // Or handle it as needed
  }
  const cleanedData = data.map(item => {
    const {
      updated_at,
      ...rest
    } = item; // Exclude updated_at
    return rest;
  });
  return crypto.createHash("md5").update(JSON.stringify(cleanedData)).digest("hex");
}

// Handle process termination to close MySQL connection gracefully
process.on("SIGINT", () => {
  console.log("Received SIGINT. Closing MySQL connection and shutting down server.");
  connection.end(err => {
    if (err) {
      console.error("Error closing MySQL connection:", err);
    } else {
      console.log("MySQL connection closed.");
    }
    process.exit(0); // Exit the process
  });
});
process.on("SIGTERM", () => {
  console.log("Received SIGTERM. Closing MySQL connection and shutting down server.");
  connection.end(err => {
    if (err) {
      console.error("Error closing MySQL connection:", err);
    } else {
      console.log("MySQL connection closed.");
    }
    process.exit(0); // Exit the process
  });
});

// WebSocket connection
wss.on("connection", ws => {
  let userId = null;
  let prevData = null;
  let currentBalance = null;
  let previousCompanyLiveCallsHash = "";
  let previousCompanyWaitCallsHash = "";

  // Handle balance fetching
  ws.on("message", message => {
    const data = JSON.parse(message);
    if (data.action === "fetchBalance") {
      userId = data.userId;

      // Function to fetch balance
      const fetchBalance = callback => {
        connection.query("SELECT id, company_name, email, balance FROM companies WHERE id = ?", [userId], (err, results) => {
          if (err) {
            console.error("Database query error:", err);
            return callback(null);
          }
          callback(results[0] ? results[0].balance : null);
        });
      };

      // Initial balance fetch
      fetchBalance(initialBalance => {
        currentBalance = initialBalance;
        ws.send(JSON.stringify({
          balance: currentBalance
        }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance(newBalance => {
            if (newBalance !== currentBalance) {
              ws.send(JSON.stringify({
                balance: newBalance
              }));
              currentBalance = newBalance;
            }
          });
        }, 2000);

        // Clear the interval on WebSocket close
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
    if (data.action === "fetchResellerBalance") {
      userId = data.userId;

      // Function to fetch the balance
      const fetchBalance = callback => {
        connection.query("SELECT balance FROM `reseller_wallets` WHERE user_id = ?", [userId], (err, results) => {
          if (err) {
            console.error("Database query error:", err);
            callback(null);
          } else {
            callback(results[0] ? results[0].balance : null);
          }
        });
      };

      // Initial balance fetch
      fetchBalance(initialBalance => {
        currentBalance = initialBalance;
        ws.send(JSON.stringify({
          balance: currentBalance
        }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance(newBalance => {
            if (newBalance !== currentBalance) {
              ws.send(JSON.stringify({
                balance: newBalance
              }));
              currentBalance = newBalance;
            }
          });
        }, 2000);

        // Clear the interval on WebSocket close
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
    if (data.action === "fetchCompanyLivecalls") {
      userId = data.userId;
      const fetchBalance = callback => {
        const query = `
          SELECT 
            companies.company_name, 
            companies.email, 
            companies.id AS company_id, 
            countries.country_name, 
            caller_num, 
            agent_channel, 
            agent_name, 
            agent_number, 
            call_status, 
            call_type, 
            tfn, 
            destination_type, 
            destination, 
            live_calls.created_at, 
            live_calls.updated_at 
          FROM 
            live_calls 
          LEFT JOIN 
            companies ON live_calls.company_id = companies.id 
          LEFT JOIN 
            countries ON live_calls.country_id = countries.id 
          WHERE 
            live_calls.call_status = 3 AND 
            live_calls.company_id = ?`;
        connection.query(query, [userId], (err, results) => {
          if (err) {
            return callback(null);
          }
          callback(results ? results : null);
        });
      };

      // Initial balance fetch
      fetchBalance(initialBalance => {
        previousCompanyLiveCallsHash = generateHash(initialBalance);
        ws.send(JSON.stringify({
          initialBalance
        }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance(livecalls => {
            ws.send(JSON.stringify({
              livecalls
            }));
            const currentHash = generateHash(livecalls);
            if (previousCompanyLiveCallsHash !== currentHash) {
              ws.send(JSON.stringify({
                livecalls
              }));
              previousCompanyLiveCallsHash = generateHash(currentHash);
            }
          });
        }, 1000);

        // Clear the interval on WebSocket close
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
    if (data.action === "fetchCompanyWaitingcalls") {
      userId = data.userId;
      const fetchWaitBalance = callback => {
        const query = `
             SELECT companies.company_name, companies.email, countries.country_name, caller_num,agent_channel,agent_name,agent_number, call_status, call_type, tfn, destination_type, destination, live_calls.created_at, live_calls.updated_at FROM live_calls left join companies on live_calls.company_id = companies.id left join countries on live_calls.country_id = countries.id where live_calls.call_status=2 and live_calls.company_id = ?`;
        connection.query(query, [userId], (err, results) => {
          if (err) {
            return callback([]);
          }
          callback(results && results.length > 0 ? results : []);
        });
      };

      // Initial balance fetch
      fetchWaitBalance(initialBalance => {
        previousCompanyWaitCallsHash = generateHash(initialBalance);
        ws.send(JSON.stringify({
          initialBalance
        }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchWaitBalance(waitcalls => {
            ws.send(JSON.stringify({
              waitcalls
            }));
            const currentHash = generateHash(waitcalls);
            if (previousCompanyWaitCallsHash !== currentHash) {
              ws.send(JSON.stringify({
                waitcalls
              }));
              previousCompanyWaitCallsHash = generateHash(currentHash);
            }
          });
        }, 1000);

        // Clear the interval on WebSocket close
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
    if (data.action === "fetchAllWaitingcalls1") {
      const fetchWaitCalls = callback => {
        const query = `
            SELECT companies.company_name, companies.email, countries.country_name, caller_num,agent_channel,agent_name,agent_number, call_status, call_type, tfn, destination_type, destination, live_calls.created_at, live_calls.updated_at FROM live_calls
            left join companies on live_calls.company_id = companies.id left join countries on live_calls.country_id = countries.id where live_calls.call_status=2`;
        connection.query(query, (err, results) => {
          if (err) {
            return callback([]);
          }
          callback(results && results.length > 0 ? results : []);
        });
      };

      // Initial balance fetch
      fetchWaitCalls(initialCalls => {
        previousCompanyWaitCallsHash = generateHash(initialCalls);
        ws.send(JSON.stringify({
          initialCalls
        }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchWaitCalls(waitcalls => {
            ws.send(JSON.stringify({
              waitcalls
            }));
            const currentHash = generateHash(waitcalls);
            if (previousCompanyWaitCallsHash !== currentHash) {
              ws.send(JSON.stringify({
                waitcalls
              }));
              previousCompanyWaitCallsHash = generateHash(currentHash);
            }
          });
        }, 1000);

        // Clear the interval on WebSocket close
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
    if (data.action === "fetchSuperAllLivecalls") {
      const fetchBalance = callback => {
        const query = `
          SELECT 
            companies.company_name, 
            companies.email, 
            companies.id AS company_id, 
            countries.country_name, 
            caller_num, 
            agent_channel, 
            agent_name, 
            agent_number, 
            call_status, 
            call_type, 
            tfn, 
            destination_type, 
            destination, 
            live_calls.created_at, 
            live_calls.updated_at 
          FROM 
            live_calls 
          LEFT JOIN 
            companies ON live_calls.company_id = companies.id 
          LEFT JOIN 
            countries ON live_calls.country_id = countries.id 
          WHERE 
            live_calls.call_status = 3`;
        connection.query(query, (err, results) => {
          if (err) {
            return callback(null);
          }
          callback(results ? results : null);
        });
      };

      // Initial balance fetch
      fetchBalance(initialBalance => {
        previousCompanyLiveCallsHash = generateHash(initialBalance);
        ws.send(JSON.stringify({
          initialBalance
        }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance(livecalls => {
            ws.send(JSON.stringify({
              livecalls
            }));
            const currentHash = generateHash(livecalls);
            if (previousCompanyLiveCallsHash !== currentHash) {
              ws.send(JSON.stringify({
                livecalls
              }));
              previousCompanyLiveCallsHash = generateHash(currentHash);
            }
          });
        }, 1000);

        // Clear the interval on WebSocket close
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
    if (data.action === "fetchNewDocs") {
      const fetchDocCount = callback => {
        const query = `SELECT count(*) as count FROM user_documents WHERE status = 0`;
        connection.query(query, (err, results) => {
          if (err) {
            return callback(err, null);
          }
          const currentCount = results[0]?.count || 0;
          callback(null, currentCount);
        });
      };

      // Initial document count fetch
      fetchDocCount((err, initialCount) => {
        if (err) {
          console.error("Error fetching count:", err);
          return;
        }
        prevData = initialCount;
        ws.send(JSON.stringify({
          count: prevData
        }));
        const balanceInterval = setInterval(() => {
          fetchDocCount((err, newCount) => {
            if (err) {
              console.error("Error fetching new count:", err);
              return;
            }
            if (newCount !== prevData && newCount > prevData) {
              ws.send(JSON.stringify({
                count: newCount
              }));
              prevData = newCount;
            }
          });
        }, 2000);
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
    if (data.action === "fetchResellerBalance") {
      userId = data.userId;

      // Function to fetch the balance
      const fetchBalance = callback => {
        connection.query("SELECT balance FROM `reseller_wallets` WHERE user_id = ?", [userId], (err, results) => {
          if (err) {
            console.error("Database query error:", err);
            callback(null);
          } else {
            callback(results[0] ? results[0].balance : null);
          }
        });
      };

      // Initial document
      fetchBalance(initialBalance => {
        currentBalance = initialBalance;
        ws.send(JSON.stringify({
          balance: currentBalance
        }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance(newBalance => {
            if (newBalance !== currentBalance) {
              ws.send(JSON.stringify({
                balance: newBalance
              }));
              currentBalance = newBalance;
            }
          });
        }, 2000);

        // Clear the interval on WebSocket close
        ws.on("close", () => {
          clearInterval(balanceInterval);
        });
      });
    }
  });
});

// Start server on port 8003
server.listen(8003, () => {
  console.log("Server is listening on port 8003");
});
//# sourceMappingURL=index.js.map