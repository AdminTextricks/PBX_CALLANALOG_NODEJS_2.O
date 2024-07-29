require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");
const sharedsession = require("express-socket.io-session");
const connection = require("./db");
const app = express();
const MySQLStore = require("express-mysql-session")(session);
const PORT = 8001;
// Middleware
app.use(bodyParser.json());
//app.use(cors({ origin: "*" }));
app.use(
  cors({
    origin: process.env.CORS_FRONTEND_URL,
    credentials: true,
  })
);
const sessionStore = new MySQLStore(connection);
const sessionMiddleware = session({
  key: "cookie_id",
  secret: process.env.SESSION_SECRET_KEY,
  resave: false, // Set to false to avoid unnecessary session resaving
  saveUninitialized: false, // Set to false to avoid saving uninitialized sessions
  store: sessionStore,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours in milliseconds
});
app.use(sessionMiddleware);
app.use(express.json());
// Routes
app.get("/", (_, res) => {
  res.send("Server running...");
});

const server = app.listen(PORT, console.log("Server is Running...", PORT));
const io = require("socket.io")(server, {
  cors: { origin: "*" },
});

io.use(sharedsession(sessionMiddleware, {
  autoSave: true // Ensure session is saved automatically
}));

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
  next();
});

const getLiveCalls = ({ company_id }) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT companies.company_name, companies.email, countries.country_name, caller_num,agent_channel,agent_name,agent_number, call_status, call_type, tfn, destination_type, destination, live_calls.created_at, live_calls.updated_at FROM live_calls
      left join companies on live_calls.company_id = companies.id
      left join countries on live_calls.country_id = countries.id
      where live_calls.call_status=3 and live_calls.company_id= ${company_id}
    `;
    connection.query(query, (err, results) => {
      if (err) {
        return reject(err);
      }
      resolve(results);
    });
  });
};

const getWaitingCalls = ({ company_id }) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT companies.company_name, companies.email, countries.country_name, caller_num,agent_channel,agent_name,agent_number, call_status, call_type, tfn, destination_type, destination, live_calls.created_at, live_calls.updated_at FROM live_calls
      left join companies on live_calls.company_id = companies.id
      left join countries on live_calls.country_id = countries.id
      where live_calls.call_status=2 and live_calls.company_id= ${company_id}
    `;
    connection.query(query, (err, results) => {
      if (err) {
        return reject(err);
      }
      resolve(results);
    });
  });
};

const getAllWaitingCalls = () => {
  return new Promise((resolve, reject) => {
    const query = `
     SELECT companies.company_name, companies.email, countries.country_name, caller_num,agent_channel,agent_name,agent_number, call_status, call_type, tfn, destination_type, destination, live_calls.created_at, live_calls.updated_at FROM live_calls
     left join companies on live_calls.company_id = companies.id
     left join countries on live_calls.country_id = countries.id
     where live_calls.call_status=2
    `;
    connection.query(query, (err, results) => {
      if (err) {
        return reject(err);
      }
      resolve(results);
    });
  });
};

const getAllLiveCalls = () => {
  return new Promise((resolve, reject) => {
    const query = `
     SELECT companies.company_name, companies.email, countries.country_name, ip, caller_num,agent_channel,agent_name,agent_number, call_status, call_type, tfn, destination_type, destination, live_calls.created_at, live_calls.updated_at FROM live_calls
     left join companies on live_calls.company_id = companies.id
     left join countries on live_calls.country_id = countries.id
     where live_calls.call_status=3
    `;
    connection.query(query, (err, results) => {
      if (err) {
        return reject(err);
      }
      resolve(results);
    });
  });
};

io.on("connection", (socket) => {
  console.log("Socket Session ID:", socket.handshake.sessionID);
  console.log("Socket Session:", socket.handshake.session);

  let prevData = null;
  let slug;
  let company_id;

  const getVerifyDoc = ({ id }) => {
    return new Promise((resolve, reject) => {
      const query = `
          SELECT
            CASE
              WHEN is_verified_doc = 0 THEN 0
              WHEN is_verified_doc = 1 THEN 1
              WHEN is_verified_doc = 2 THEN 2
              WHEN is_verified_doc = 3 THEN 3
              ELSE 'Unknown status'
            END AS status_message
          FROM users
          WHERE id = ${id};
        `;
      connection.query(query, (err, results) => {
        if (err) {
          return reject(err);
        }
        const statusMessage =
          results.length > 0 ? results[0].status_message : "No record found";
        resolve(statusMessage);
      });
    });
  };

  const pollStatus = async (userdata, previousStatus) => {
    try {
      const result = await getVerifyDoc(userdata);
      const currentStatus = result;
      if (currentStatus !== previousStatus) {
        socket.emit("isVerifiedDoc", {
          userId: userdata.id,
          statusMessage: result,
        });
      }
      if (currentStatus != 1) {
        setTimeout(() => pollStatus(userdata, currentStatus), 2000);
      }
    } catch (error) {
      setTimeout(() => pollStatus(userdata, previousStatus), 2000);
    }
  };

  const getDocumentsCount = () => {
    return new Promise((resolve, reject) => {
      const query = `SELECT count(*) as count FROM user_documents`;
      connection.query(query, (err, results) => {
        if (err) {
          return reject(err);
        }
        const currentCount = results[0]?.count;
        if (prevData !== null && currentCount !== prevData) {
          socket.emit("changeDocCount", { count: currentCount });
        }
        prevData = currentCount;
        resolve(currentCount);
      });
    });
  };

  const getBalanceByCompany = (id) => {
    return new Promise((resolve, reject) => {
      const query = `SELECT id,company_name,email, balance FROM companies where id = ${id}`;
      connection.query(query, (err, results) => {
        if (err) {
          return reject(err);
        }
        const currentBalalnce = results[0]?.balance;
        socket.emit("fetchBalance", currentBalalnce);
        resolve(currentBalalnce);
      });
    });
  };

  socket.on("allUsers", function () {
    const userdata = socket.handshake.session.userdata;
    socket.emit("getUsers", { data: userdata });
  });

  socket.on("login", async (userdata) => {
    console.log(">>>>>>>");
    socket.handshake.session.userdata = userdata;
    socket.handshake.session.save(async (err) => {
      if (userdata.is_verified_doc !== 1) {
        pollStatus(userdata, null);
      }
    });
  });

  //Upload documents notification
  socket.on("handleFetchNewDocs", async ({ params }) => {
    try {
      await getDocumentsCount();
    } catch (error) {
      console.log("Error");
    }
  });
  const fetchAllDocs = setInterval(async () => {
    if (["super-admin", "noc", "support"].includes(slug)) {
      await getDocumentsCount();
    }
  }, 3000);
  socket.on("disconnect", () => {
    clearInterval(fetchAllDocs);
  });

  //balance
  socket.on("fetchBalanceReq", async (id) => {
    await getBalanceByCompany(id);
  });

  //Live calls
  socket.on("fetchLiveCallsReq", async (data) => {
    try {
      company_id = data.company_id;
      const liveCalls = await getLiveCalls(data);
      socket.emit("getLiveCallsRes", liveCalls);
    } catch (error) {
      socket.emit("getLiveCallsRes", { error: "Internal server error" });
    }
  });
  const fetchLiveCallsInterval = setInterval(async () => {
    if (company_id) {
      const data = { company_id: company_id };
      const liveCalls = await getLiveCalls(data);
      socket.emit("getLiveCallsRes", liveCalls);
    }
  }, 1000);
  socket.on("disconnect", () => {
    clearInterval(fetchLiveCallsInterval);
  });

  //Waiting calls
  socket.on("fetchWaitingCallsReq", async (data) => {
    try {
      company_id = data.company_id;
      const waitingCalls = await getWaitingCalls(data);
      socket.emit("getWaitingCallsRes", waitingCalls);
    } catch (error) {
      socket.emit("getWaitingCallsRes", { error: "Internal server error" });
    }
  });
  const fetchWaitingCallsInterval = setInterval(async () => {
    if (company_id) {
      const data = { company_id: company_id };
      const waitingCalls = await getWaitingCalls(data);
      socket.emit("getWaitingCallsRes", waitingCalls);
    }
  }, 1000);
  socket.on("disconnect", () => {
    clearInterval(fetchWaitingCallsInterval);
  });

  //All Waiting calls
  socket.on("fetchAllWaitingCallsReq", async (data) => {
    try {
      slug = data.slug;
      const waitingCalls = await getAllWaitingCalls();
      socket.emit("getAllWaitingCallsRes", waitingCalls);
    } catch (error) {
      socket.emit("getAllWaitingCallsRes", { error: "Internal server error" });
    }
  });
  const fetchAllWaitingCallsInterval = setInterval(async () => {
    if (["super-admin", "noc", "support", "reseller"].includes(slug)) {
      const waitingCalls = await getAllWaitingCalls();
      socket.emit("getAllWaitingCallsRes", waitingCalls);
    }
  }, 1000);
  socket.on("disconnect", () => {
    clearInterval(fetchAllWaitingCallsInterval);
  });

  //All Live calls
  socket.on("fetchAllLiveCallsReq", async (data) => {
    try {
      slug = data.slug;
      const allLiveCalls = await getAllLiveCalls();
      socket.emit("getAllAllCallsRes", allLiveCalls);
    } catch (error) {
      socket.emit("getAllAllCallsRes", { error: "Internal server error" });
    }
  });
  const fetchAllLiveCallsInterval = setInterval(async () => {
    if (["super-admin", "noc", "support", "reseller"].includes(slug)) {
      const fetchAllLiveCallsInterval = await getAllLiveCalls();
      socket.emit("getAllAllCallsRes", fetchAllLiveCallsInterval);
    }
  }, 1000);
  socket.on("disconnect", () => {
    clearInterval(fetchAllLiveCallsInterval);
  });

  socket.on("logout", function () {
    if (socket.handshake.session.userdata) {
      delete socket.handshake.session.userdata;
      socket.handshake.session.save();
    }
  });
});

app.use((req, res, next) => {
  console.log("Session ID:", req.sessionID);
  console.log("Session:", req.session);
  next();
});
