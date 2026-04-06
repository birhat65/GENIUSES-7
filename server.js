const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const session = require("express-session");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2), "utf8");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "shadow-hook-panel-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

const timers = new Map();

function loadDb() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const db = JSON.parse(raw);
    if (!db.users || typeof db.users !== "object") {
      return { users: {} };
    }
    return db;
  } catch (error) {
    console.error("Could not read users file:", error);
    return { users: {} };
  }
}

function saveDb(db) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2), "utf8");
}

function getSafeUserView(username, user) {
  return {
    username,
    webhookUrl: user.webhookUrl || "",
    message: user.message || "",
    intervalHours: Number(user.intervalHours || 24),
    isRunning: Boolean(user.isRunning),
    nextSendAt: user.nextSendAt || null,
    lastSentAt: user.lastSentAt || null
  };
}

function looksLikeWebhook(url) {
  const clean = String(url || "").trim();
  return /^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(clean);
}

async function postToDiscord(webhookUrl, message) {
  const cleanUrl = String(webhookUrl || "").trim();
  const cleanMessage = String(message || "").trim();

  if (!cleanUrl) return { success: false, message: "Webhook URL is empty." };
  if (!looksLikeWebhook(cleanUrl)) return { success: false, message: "Webhook URL looks invalid." };
  if (!cleanMessage) return { success: false, message: "Message cannot be empty." };
  if (cleanMessage.length > 2000) return { success: false, message: "Discord message limit is 2000 characters." };

  try {
    const response = await axios.post(
      cleanUrl,
      {
        content: cleanMessage,
        allowed_mentions: { parse: ["everyone"] }
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
        validateStatus: () => true
      }
    );

    if (response.status < 200 || response.status >= 300) {
      const discordMsg =
        response.data?.message ||
        response.data?.errors?.content?._errors?.[0]?.message ||
        `Discord error code: ${response.status}`;
      return { success: false, message: "Discord rejected the message: " + discordMsg };
    }

    return { success: true, message: "Message sent successfully." };
  } catch (error) {
    return { success: false, message: "Could not send to Discord: " + (error.message || "Unknown error") };
  }
}

function clearUserTimer(username) {
  const timer = timers.get(username);
  if (timer) {
    clearTimeout(timer);
    timers.delete(username);
  }
}

async function sendDiscordMessageForUser(username) {
  const db = loadDb();
  const user = db.users[username];
  if (!user || !user.isRunning) return;

  const result = await postToDiscord(user.webhookUrl, user.message);
  if (!result.success) {
    console.error(`[${username}]`, result.message);
    return;
  }

  const now = new Date();
  user.lastSentAt = now.toISOString();
  user.nextSendAt = new Date(now.getTime() + Number(user.intervalHours || 24) * 60 * 60 * 1000).toISOString();
  db.users[username] = user;
  saveDb(db);

  scheduleNextForUser(username);
}

function scheduleNextForUser(username) {
  clearUserTimer(username);

  const db = loadDb();
  const user = db.users[username];
  if (!user || !user.isRunning || !user.nextSendAt) return;

  const delay = new Date(user.nextSendAt).getTime() - Date.now();

  if (delay <= 0) {
    sendDiscordMessageForUser(username);
    return;
  }

  const timer = setTimeout(() => {
    sendDiscordMessageForUser(username);
  }, delay);

  timers.set(username, timer);
}

function startSchedulerForUser(username, sendNow = false) {
  const db = loadDb();
  const user = db.users[username];
  if (!user) return;

  user.isRunning = true;
  const now = new Date();
  user.nextSendAt = sendNow
    ? now.toISOString()
    : new Date(now.getTime() + Number(user.intervalHours || 24) * 60 * 60 * 1000).toISOString();

  db.users[username] = user;
  saveDb(db);
  scheduleNextForUser(username);
}

function stopSchedulerForUser(username) {
  const db = loadDb();
  const user = db.users[username];
  if (!user) return;

  user.isRunning = false;
  user.nextSendAt = null;
  db.users[username] = user;
  saveDb(db);
  clearUserTimer(username);
}

function requireAuth(req, res, next) {
  if (!req.session.username) {
    return res.status(401).json({ success: false, message: "Please log in first." });
  }
  next();
}

app.post("/api/register", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!username || username.length < 3) {
    return res.status(400).json({ success: false, message: "Username must be at least 3 characters." });
  }

  if (!/^[a-z0-9_.-]+$/i.test(username)) {
    return res.status(400).json({ success: false, message: "Username can only use letters, numbers, dot, dash, or underscore." });
  }

  if (!password || password.length < 4) {
    return res.status(400).json({ success: false, message: "Password must be at least 4 characters." });
  }

  const db = loadDb();
  if (db.users[username]) {
    return res.status(400).json({ success: false, message: "This username already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.users[username] = {
    passwordHash,
    webhookUrl: "",
    message: "Hello! This is your automatic 24-hour message.",
    intervalHours: 24,
    isRunning: false,
    nextSendAt: null,
    lastSentAt: null
  };
  saveDb(db);

  req.session.username = username;
  return res.json({
    success: true,
    message: "Account created.",
    user: getSafeUserView(username, db.users[username])
  });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const db = loadDb();
  const user = db.users[username];

  if (!user) {
    return res.status(400).json({ success: false, message: "User not found." });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(400).json({ success: false, message: "Wrong password." });
  }

  req.session.username = username;
  return res.json({
    success: true,
    message: "Logged in.",
    user: getSafeUserView(username, user)
  });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: "Logged out." });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.username) {
    return res.json({ loggedIn: false });
  }

  const db = loadDb();
  const user = db.users[req.session.username];
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ loggedIn: false });
  }

  res.json({ loggedIn: true, user: getSafeUserView(req.session.username, user) });
});

app.get("/api/user-settings", requireAuth, (req, res) => {
  const db = loadDb();
  const user = db.users[req.session.username];
  res.json({ success: true, user: getSafeUserView(req.session.username, user) });
});

app.post("/api/user-settings", requireAuth, (req, res) => {
  const db = loadDb();
  const user = db.users[req.session.username];

  user.webhookUrl = typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl.trim() : user.webhookUrl;
  user.message = typeof req.body?.message === "string" ? req.body.message : user.message;

  const parsedInterval = Number(req.body?.intervalHours);
  user.intervalHours = Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : 24;

  db.users[req.session.username] = user;
  saveDb(db);

  res.json({ success: true, message: "Settings saved.", user: getSafeUserView(req.session.username, user) });
});

app.post("/api/start", requireAuth, (req, res) => {
  const db = loadDb();
  const user = db.users[req.session.username];

  if (!user.webhookUrl || !user.webhookUrl.trim()) {
    return res.status(400).json({ success: false, message: "Please enter a webhook URL first." });
  }

  if (!user.message || !user.message.trim()) {
    return res.status(400).json({ success: false, message: "Please enter a message first." });
  }

  startSchedulerForUser(req.session.username, false);

  const updatedDb = loadDb();
  res.json({
    success: true,
    message: "Scheduler started.",
    user: getSafeUserView(req.session.username, updatedDb.users[req.session.username])
  });
});

app.post("/api/stop", requireAuth, (req, res) => {
  stopSchedulerForUser(req.session.username);

  const updatedDb = loadDb();
  res.json({
    success: true,
    message: "Scheduler stopped.",
    user: getSafeUserView(req.session.username, updatedDb.users[req.session.username])
  });
});

app.post("/api/test", requireAuth, async (req, res) => {
  const db = loadDb();
  const user = db.users[req.session.username];
  const result = await postToDiscord(user.webhookUrl, user.message);

  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json(result);
});

app.post("/api/send-now", requireAuth, async (req, res) => {
  const db = loadDb();
  const user = db.users[req.session.username];
  const result = await postToDiscord(user.webhookUrl, user.message);

  if (!result.success) {
    return res.status(400).json(result);
  }

  user.lastSentAt = new Date().toISOString();

  if (user.isRunning) {
    user.nextSendAt = new Date(Date.now() + Number(user.intervalHours || 24) * 60 * 60 * 1000).toISOString();
    db.users[req.session.username] = user;
    saveDb(db);
    scheduleNextForUser(req.session.username);
  } else {
    db.users[req.session.username] = user;
    saveDb(db);
  }

  res.json({
    success: true,
    message: "Message sent immediately.",
    user: getSafeUserView(req.session.username, user)
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);

  const db = loadDb();
  for (const username of Object.keys(db.users)) {
    if (db.users[username].isRunning && db.users[username].nextSendAt) {
      scheduleNextForUser(username);
    }
  }
});
