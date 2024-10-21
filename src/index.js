const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");
const connection = require("./db");
const crypto = require("crypto");
const app = express();
const fs = require("fs");
const bodyParser = require("body-parser");
const logger = require("./Logger");

app.use(bodyParser.json());

// Development>>>>>>>>>>>>>>>>
// const http = require("http");
// const server = http.createServer(app);
// const wss = new WebSocket.Server({ server });

// Production>>>>>>>>>>>>>>>>>>

const https = require("https");
const options = {
  cert: fs.readFileSync(
    "/etc/letsencrypt/live/socket.callanalog.com-0004/fullchain.pem"
  ), // Path to SSL certificate
  key: fs.readFileSync(
    "/etc/letsencrypt/live/socket.callanalog.com-0004/privkey.pem"
  ), // Path to SSL key
  //ca: fs.readFileSync("/etc/letsencrypt/live/socket.callanalog.com/chain.pem")
};
const server = https.createServer(options, app);
const wss = new WebSocket.Server({ server });

// Enable CORS
app.use(
  cors({
    origin: process.env.CORS_FRONTEND_URL,
    credentials: true,
  })
);

function generateHash(data) {
  // Ensure data is an array
  if (!Array.isArray(data)) {
    return null; // Or handle it as needed
  }

  const cleanedData = data.map((item) => {
    const { updated_at, ...rest } = item; // Exclude updated_at
    return rest;
  });

  return crypto
    .createHash("md5")
    .update(JSON.stringify(cleanedData))
    .digest("hex");
}

// Handle process termination to close MySQL connection gracefully
process.on("SIGINT", () => {
  connection.end((err) => {
    if (err) {
      logger.error(err);
    } else {
      logger.info("MySQL connection closed.");
    }
    process.exit(0); // Exit the process
  });
});

process.on("SIGTERM", () => {
  connection.end((err) => {
    if (err) {
      logger.error(err);
    } else {
      logger.info("MySQL connection closed.");
    }
    process.exit(0); // Exit the process
  });
});

// WebSocket connection
wss.on("connection", (ws) => {
  let userId = null;
  let id = null;
  let user_type = null;
  let prevData = null;
  let currentBalance = null;
  let previousCompanyLiveCallsHash = "";
  let previousCompanyWaitCallsHash = "";
  let currentDocStatus = "";
  let todayLiveCountHash = "";
  let todayAnswerCountHash = "";

  let prevUnreadCount = null;

  // Handle balance fetching
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.action === "fetchUserActive") {
      id = data.id;
      const fetchUserActive = (callback) => {
        connection.query(
          "SELECT status FROM users WHERE id = ?",
          [id],
          (err, results) => {
            if (err) {
              return callback(null);
            }
            callback(results[0] || null);
          }
        );
      };

      fetchUserActive((userData) => {
        if (userData && userData.status === 0) {
          ws.send(
            JSON.stringify({
              user_status: {
                message: "Access denied: User status is inactive.",
                is_active: false,
              },
            })
          );
        }
        const fetchUserActiveInterval = setInterval(() => {
          fetchUserActive((userData) => {
            if (userData && userData.status === 0) {
              ws.send(
                JSON.stringify({
                  user_status: {
                    message: "Your account has been suspended.",
                    is_active: false,
                  },
                })
              );
            }
          });
        }, 4000);

        ws.on("close", () => {
          clearInterval(fetchUserActiveInterval);
        });
      });
    }

    if (data.action === "fetchBalance") {
      userId = data.userId;

      // Function to fetch balance
      const fetchBalance = (callback) => {
        connection.query(
          "SELECT id, company_name, email, balance FROM companies WHERE id = ?",
          [userId],
          (err, results) => {
            if (err) {
              return callback(null);
            }
            callback(results[0] ? results[0].balance : null);
          }
        );
      };

      // Initial balance fetch
      fetchBalance((initialBalance) => {
        currentBalance = initialBalance;
        ws.send(JSON.stringify({ balance: currentBalance }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance((newBalance) => {
            if (newBalance !== currentBalance) {
              ws.send(JSON.stringify({ balance: newBalance }));
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
      const fetchBalance = (callback) => {
        connection.query(
          "SELECT balance FROM `reseller_wallets` WHERE user_id = ?",
          [userId],
          (err, results) => {
            if (err) {
              logger.error("Database query error:", err);
              callback(null);
            } else {
              callback(results[0] ? results[0].balance : null);
            }
          }
        );
      };

      // Initial balance fetch
      fetchBalance((initialBalance) => {
        currentBalance = initialBalance;
        ws.send(JSON.stringify({ balance: currentBalance }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance((newBalance) => {
            if (newBalance !== currentBalance) {
              ws.send(JSON.stringify({ balance: newBalance }));
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

      const fetchBalance = (callback) => {
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
      fetchBalance((initialBalance) => {
        previousCompanyLiveCallsHash = generateHash(initialBalance);

        ws.send(JSON.stringify({ initialBalance }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance((livecalls) => {
            ws.send(JSON.stringify({ livecalls }));
            const currentHash = generateHash(livecalls);
            if (previousCompanyLiveCallsHash !== currentHash) {
              ws.send(JSON.stringify({ livecalls }));
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

      const fetchWaitBalance = (callback) => {
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
      fetchWaitBalance((initialBalance) => {
        previousCompanyWaitCallsHash = generateHash(initialBalance);

        ws.send(JSON.stringify({ initialBalance }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchWaitBalance((waitcalls) => {
            ws.send(JSON.stringify({ waitcalls }));
            const currentHash = generateHash(waitcalls);
            if (previousCompanyWaitCallsHash !== currentHash) {
              ws.send(JSON.stringify({ waitcalls }));
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

    if (data.action === "fetchAllWaitingcalls") {
      const fetchWaitCalls = (callback) => {
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
      fetchWaitCalls((initialCalls) => {
        previousCompanyWaitCallsHash = generateHash(initialCalls);

        ws.send(JSON.stringify({ initialCalls }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchWaitCalls((waitcalls) => {
            ws.send(JSON.stringify({ waitcalls }));
            const currentHash = generateHash(waitcalls);
            if (previousCompanyWaitCallsHash !== currentHash) {
              ws.send(JSON.stringify({ waitcalls }));
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
      const fetchBalance = (callback) => {
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
      fetchBalance((initialBalance) => {
        previousCompanyLiveCallsHash = generateHash(initialBalance);

        ws.send(JSON.stringify({ initialBalance }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance((livecalls) => {
            ws.send(JSON.stringify({ livecalls }));
            const currentHash = generateHash(livecalls);
            if (previousCompanyLiveCallsHash !== currentHash) {
              ws.send(JSON.stringify({ livecalls }));
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
      const fetchDocCount = (callback) => {
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
          return;
        }

        prevData = initialCount;
        ws.send(JSON.stringify({ count: prevData }));

        const balanceInterval = setInterval(() => {
          fetchDocCount((err, newCount) => {
            if (err) {
              return;
            }
            if (newCount !== prevData && newCount > prevData) {
              ws.send(JSON.stringify({ count: newCount }));
              prevData = newCount;
            } else if (newCount !== prevData && newCount < prevData) {
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
      const fetchBalance = (callback) => {
        connection.query(
          "SELECT balance FROM `reseller_wallets` WHERE user_id = ?",
          [userId],
          (err, results) => {
            if (err) {
              logger.error("Database query error:", err);
              callback(null);
            } else {
              callback(results[0] ? results[0].balance : null);
            }
          }
        );
      };

      // Initial document
      fetchBalance((initialBalance) => {
        currentBalance = initialBalance;
        ws.send(JSON.stringify({ balance: currentBalance }));

        // Balance update interval
        const balanceInterval = setInterval(() => {
          fetchBalance((newBalance) => {
            if (newBalance !== currentBalance) {
              ws.send(JSON.stringify({ balance: newBalance }));
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

    if (data.action === "fetchDocStatus") {
      userId = data.userId;

      // Function to fetch company doc status
      const fetchDocStatus = (callback) => {
        connection.query(
          `SELECT CASE WHEN is_verified_doc = 0 THEN 0 WHEN is_verified_doc = 1 THEN 1 WHEN is_verified_doc = 2 THEN 2 WHEN is_verified_doc = 3 THEN 3 ELSE 'Unknown status' END AS status_message
          FROM users
          WHERE company_id = ?`,
          [userId],
          (err, results) => {
            if (err) {
              return callback(null);
            }
            callback(results[0] ? results[0].status_message : null);
          }
        );
      };

      fetchDocStatus((initStatus) => {
        currentDocStatus = initStatus;
        ws.send(JSON.stringify({ status: currentDocStatus }));

        const fetchDocStatusInterval = setInterval(() => {
          fetchDocStatus((newStatus) => {
            if (newStatus !== currentDocStatus) {
              ws.send(JSON.stringify({ status: newStatus }));
              currentDocStatus = newStatus;
            }
          });
        }, 2000);

        ws.on("close", () => {
          clearInterval(fetchDocStatusInterval);
        });
      });
    }

    if (data.action === "GET_CALLS_COUNT_FOR_SUPERADMIN") {
      const GET_CALLS_COUNT_FOR_SUPERADMIN = (callback) => {
        const query = `SELECT COUNT(CASE WHEN DATE(call_start_time) = CURDATE() - INTERVAL 1 DAY THEN 1 END) AS prev_count,COUNT(CASE WHEN DATE(call_start_time) = CURDATE() THEN 1 END) AS today_count FROM cdrs;`;
        connection.query(query, (err, results) => {
          if (err) {
            return callback(null);
          }
          callback(results ? results[0] : null);
        });
      };
      GET_CALLS_COUNT_FOR_SUPERADMIN((initCount) => {
        todayLiveCountHash = initCount?.today_count;
        ws.send(JSON.stringify({ initCount }));
        const SUPERADMIN_CALLS_COUNT_INTERVAL = setInterval(() => {
          GET_CALLS_COUNT_FOR_SUPERADMIN((initCount) => {
            const currentHash = initCount?.today_count;
            if (todayLiveCountHash !== currentHash) {
              todayLiveCountHash = currentHash;
              ws.send(JSON.stringify({ initCount }));
            }
          });
        }, 1000);

        ws.on("close", () => {
          clearInterval(SUPERADMIN_CALLS_COUNT_INTERVAL);
        });
      });
    }

    if (data.action === "GET_ANSWER_CALLS_COUNT_FOR_SUPERADMIN") {
      const GET_ANSWER_CALLS_COUNT_FOR_SUPERADMIN = (callback) => {
        const query = `SELECT COUNT(CASE WHEN DATE(call_start_time) = CURDATE() - INTERVAL 1 DAY THEN 1 END) AS prev_count,COUNT(CASE WHEN DATE(call_start_time) = CURDATE() THEN 1 END) AS today_count FROM cdrs WHERE disposition = 'ANSWER' ;`;
        connection.query(query, (err, results) => {
          if (err) {
            return callback(null);
          }
          callback(results ? results[0] : null);
        });
      };
      GET_ANSWER_CALLS_COUNT_FOR_SUPERADMIN((initAnsCount) => {
        todayAnswerCountHash = initAnsCount?.today_count;
        ws.send(JSON.stringify({ initAnsCount }));
        const SUPERADMIN_CALLS_ANS_COUNT_INTERVAL = setInterval(() => {
          GET_ANSWER_CALLS_COUNT_FOR_SUPERADMIN((initAnsCount) => {
            const currentHash = initAnsCount?.today_count;
            if (todayAnswerCountHash !== currentHash) {
              todayAnswerCountHash = currentHash;
              ws.send(JSON.stringify({ initAnsCount }));
            }
          });
        }, 1000);

        ws.on("close", () => {
          clearInterval(SUPERADMIN_CALLS_ANS_COUNT_INTERVAL);
        });
      });
    }

    if (data.action === "GET_CALLS_COUNT_FOR_COMPANY") {
      userId = data.userId;

      const GET_CALLS_COUNT_FOR_COMPANY = (callback) => {
        const query = `SELECT COUNT(CASE WHEN DATE(call_start_time) = CURDATE() - INTERVAL 1 DAY THEN 1 END) AS prev_count,COUNT(CASE WHEN DATE(call_start_time) = CURDATE() THEN 1 END) AS today_count FROM cdrs WHERE company_id = ?;`;
        connection.query(query, [userId], (err, results) => {
          if (err) {
            return callback(null);
          }
          callback(results ? results[0] : null);
        });
      };
      GET_CALLS_COUNT_FOR_COMPANY((initCount) => {
        todayLiveCountHash = initCount?.today_count;
        ws.send(JSON.stringify({ initCount }));
        const COMPANY_CALLS_COUNT_INTERVAL = setInterval(() => {
          GET_CALLS_COUNT_FOR_COMPANY((initCount) => {
            const currentHash = initCount?.today_count;
            if (todayLiveCountHash !== currentHash) {
              todayLiveCountHash = currentHash;
              ws.send(JSON.stringify({ initCount }));
            }
          });
        }, 1000);

        ws.on("close", () => {
          clearInterval(COMPANY_CALLS_COUNT_INTERVAL);
        });
      });
    }

    if (data.action === "GET_ANSWER_CALLS_COUNT_FOR_COMPANY") {
      userId = data.userId;

      const GET_ANSWER_CALLS_COUNT_FOR_COMPANY = (callback) => {
        const query = `SELECT COUNT(CASE WHEN DATE(call_start_time) = CURDATE() - INTERVAL 1 DAY THEN 1 END) AS prev_count, COUNT(CASE WHEN DATE(call_start_time) = CURDATE() THEN 1 END) AS today_count FROM cdrs WHERE disposition = 'ANSWER' AND company_id = ?;`;
        connection.query(query, [userId], (err, results) => {
          if (err) {
            return callback(null);
          }
          callback(results ? results[0] : null);
        });
      };
      GET_ANSWER_CALLS_COUNT_FOR_COMPANY((initAnsCount) => {
        todayAnswerCountHash = initAnsCount?.today_count;
        ws.send(JSON.stringify({ initAnsCount }));
        const COMPANY_CALLS_ANS_COUNT_INTERVAL = setInterval(() => {
          GET_ANSWER_CALLS_COUNT_FOR_COMPANY((initAnsCount) => {
            const currentHash = initAnsCount?.today_count;
            if (todayAnswerCountHash !== currentHash) {
              todayAnswerCountHash = currentHash;
              ws.send(JSON.stringify({ initAnsCount }));
            }
          });
        }, 1000);

        ws.on("close", () => {
          clearInterval(COMPANY_CALLS_ANS_COUNT_INTERVAL);
        });
      });
    }

    if (data.action === "GET_NOTIFICATION") {
      id = data?.user_data?.user_id;
      user_type = data?.user_data?.user_type;

      const superadmin_query = `
      SELECT 
          (SELECT COUNT(*) 
           FROM notification_recipients 
           WHERE is_read = 0 
           AND user_type = ?) AS notification_recipients_count,
          JSON_ARRAYAGG(JSON_OBJECT(
              'id', limited_n.notification_id,
              'notification_recipient_id', limited_n.notification_recipient_id,
              'subject', limited_n.subject,
              'message', limited_n.message,
              'type', limited_n.type,
              'created_at', limited_n.created_at
          )) AS data
      FROM (
          SELECT 
              n.id AS notification_id, 
              nr.id AS notification_recipient_id,
              n.subject, 
              n.message, 
              n.type, 
              n.created_at
          FROM 
              notification_recipients nr
          INNER JOIN 
              notifications n 
              ON nr.notification_id = n.id
          WHERE 
              nr.is_read = 0 
              AND nr.user_type = ?
          ORDER BY 
              n.created_at DESC
          LIMIT 10
      ) AS limited_n;
    `;

      const user_query = `
  SELECT 
      (SELECT COUNT(*) 
       FROM notification_recipients 
       WHERE is_read = 0 
       AND user_id = ?) AS notification_recipients_count,
      JSON_ARRAYAGG(JSON_OBJECT(
          'id', limited_n.notification_id,
          'notification_recipient_id', limited_n.notification_recipient_id,
          'subject', limited_n.subject,
          'message', limited_n.message,
          'type', limited_n.type,
           'created_at', limited_n.created_at
      )) AS data
  FROM (
      SELECT 
          n.id AS notification_id, 
          nr.id AS notification_recipient_id,
          n.subject, 
          n.message, 
          n.type,
           n.created_at
      FROM 
          notification_recipients nr
      INNER JOIN 
          notifications n 
          ON nr.notification_id = n.id
      WHERE 
          nr.is_read = 0 
          AND nr.user_id = ?
      ORDER BY 
          n.created_at DESC
      LIMIT 10
  ) AS limited_n;
`;

      const GET_NOTIFICATION = ({ id, user_type }, callback) => {
        if (["super-admin", "noc", "support"].includes(user_type)) {
          connection.query(
            superadmin_query,
            [user_type, user_type],
            (err, results) => {
              if (err) {
                return callback(null);
              }
              prevUnreadCount = results[0]?.notification_recipients_count;
              // ws.send(
              //   JSON.stringify({
              //     getNotification: {
              //       data: JSON.parse(results[0].data),
              //       unread_counts: results[0]?.notification_recipients_count,
              //     },
              //   })
              // );
              callback(results || null);
            }
          );
        } else {
          connection.query(user_query, [id, id], (err, results) => {
            if (err) {
              return callback(null);
            }
            callback(results || null);
          });
        }
      };

      setInterval(() => {
        GET_NOTIFICATION({ id, user_type }, (newNotification) => {
          if (Array.isArray(newNotification) && newNotification.length > 0) {
            const unreadCount =
              newNotification[0]?.notification_recipients_count;
            const data = JSON.parse(newNotification[0].data);

            if (
              unreadCount !== prevUnreadCount ||
              JSON.stringify(data) !== JSON.stringify(prevData)
            ) {
              prevUnreadCount = unreadCount;
              prevData = data;

              ws.send(
                JSON.stringify({
                  getNotification: {
                    data: data,
                    unread_counts: unreadCount,
                  },
                })
              );
            }
          }
        });
      }, 2000);

      // setInterval(() => {
      //   GET_NOTIFICATION({ id, user_type }, (newNotification) => {
      //     if (
      //       Array.isArray(newNotification) &&
      //       newNotification.length > 0 &&
      //       newNotification[0]?.notification_recipients_count !==
      //         prevUnreadCount
      //     ) {
      //       prevUnreadCount = newNotification[0]?.notification_recipients_count;
      //       ws.send(
      //         JSON.stringify({
      //           getNotification: {
      //             data: JSON.parse(newNotification[0].data),
      //             unread_counts:
      //               newNotification[0]?.notification_recipients_count,
      //           },
      //         })
      //       );
      //     }
      //   });
      // }, 2000);
    }
  });
});

// Start server on port 8003
server.listen(8003, () => {
  logger.info("Server is listening on port 8003");
});
