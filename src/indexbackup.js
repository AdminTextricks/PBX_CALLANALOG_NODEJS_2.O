const https = require("https");
const fs = require("fs");
const express = require("express");
const app = express();
const cors = require("cors");
const connection = require("./db");
const bodyParser = require("body-parser");
const session = require("express-session");
const sharedsession = require("express-socket.io-session");

const PORT = 8001;

const options = {
  key: fs.readFileSync(
    "/etc/letsencrypt/live/pbxbackend.callanalog.com/privkey.pem"
  ),
  cert: fs.readFileSync(
    "/etc/letsencrypt/live/pbxbackend.callanalog.com/cert.pem"
  ),
};

https.createServer(options, app).listen(PORT, () => {
  console.log(`Server is running at https://pbxbackend.callanalog.com:${PORT}`);
});

app.use(bodyParser.json());

app.use(
  cors({
    origin: "*",
  })
);

const sessionMiddleware = session({
  secret: "12345",
  resave: true,
  saveUninitialized: true,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours in milliseconds
  },
});

app.use(sessionMiddleware);

app.use(express.json());

const server = app.listen(PORT, console.log("Server is Running...", PORT));

app.get("/", (_, res) => {
  res.send("Server runing...");
});

////////////////////Socket Module/////////////////////////////

const io = require("socket.io")(https, {
  cors: {
    origin: "*",
  },
});

io.use(sharedsession(sessionMiddleware));

io.on("connection", function (socket) {
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
          socket.emit("changeDocCount", {
            count: currentCount,
          });
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
      if (err) {
      } else {
        if (userdata.is_verified_doc !== 1) {
          pollStatus(userdata, null);
        }
      }
    });
  });

  socket.on("changeDocCount", async () => {
    const role_id = socket.handshake.session.userdata.role_id;
    if (role_id === "1" || role_id === "2" || role_id === "3") {
      setInterval(async () => {
        await getDocumentsCount();
      }, 5000);
    }
  });

  socket.on("logout", function (userdata) {
    if (socket.handshake.session.userdata) {
      delete socket.handshake.session.userdata;
      socket.handshake.session.save((err) => {
        if (err) {
        } else {
        }
      });
    }
  });
});

module.exports = app;
