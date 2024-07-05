require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");
const sharedsession = require("express-socket.io-session");
const connection = require("./db");
const app = express();

const PORT = process.env.PORT || 8001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

const sessionMiddleware = session({
  secret: "12345",
  resave: true,
  saveUninitialized: true,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours in milliseconds
});

app.use(sessionMiddleware);
app.use(express.json());

// Routes
app.get("/", (_, res) => {
  res.send("Server running...");
});

let server;
if (NODE_ENV === 'production') {
  const options = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH)
  };
  server = https.createServer(options, app);
} else {
  server = http.createServer(app);
}

// Socket.IO setup
const io = require("socket.io")(server, {
  cors: { origin: "*" }
});

io.use(sharedsession(sessionMiddleware));

io.on("connection", (socket) => {
  if (socket.handshake.session.userdata) {
    const userdata = socket.handshake.session.userdata;
    console.log("User connected", userdata);
  } else {
    console.log("No userdata found in session.");
  }

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
        const statusMessage = results.length > 0 ? results[0].status_message : "No record found";
        resolve(statusMessage);
      });
    });
  };

  const pollStatus = async (userdata, previousStatus) => {
    try {
      const result = await getVerifyDoc(userdata);
      const currentStatus = result;
      if (currentStatus !== previousStatus) {
        socket.emit("isVerifiedDoc", { userId: userdata.id, statusMessage: result });
      }
      if (currentStatus != 1) {
        setTimeout(() => pollStatus(userdata, currentStatus), 2000);
      }
    } catch (error) {
      setTimeout(() => pollStatus(userdata, previousStatus), 2000);
    }
  };

  let prevData = null;

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

  socket.on("allUsers", function () {
    const userdata = socket.handshake.session.userdata;
    socket.emit("getUsers", { data: userdata });
  });

  socket.on("login", async (userdata) => {
    socket.handshake.session.userdata = userdata;
    socket.handshake.session.save(async (err) => {
      if (!err && userdata.is_verified_doc !== 1) {
        pollStatus(userdata, null);
      }
    });
  });

  socket.on("changeDocCount", async () => {
    const role_id = socket.handshake.session.userdata.role_id;
    if (["1", "2", "3"].includes(role_id)) {
      setInterval(async () => {
        await getDocumentsCount();
      }, 5000);
    }
  });

  socket.on("logout", function () {
    if (socket.handshake.session.userdata) {
      delete socket.handshake.session.userdata;
      socket.handshake.session.save();
    }
  });
});

// Start the server
server.listen(PORT, () => {
  const protocol = NODE_ENV === 'production' ? 'https' : 'http';
  console.log(`Server is running at ${protocol}://pbxbackend.callanalog.com:${PORT}`);
});
