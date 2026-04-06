const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const multer = require("multer");
const FormData = require("form-data");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2), "utf8");

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 24 * 1024 * 1024, files: 10 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.SESSION_SECRET || "shadow-v9-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const timers = new Map();

function loadDb() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const db = JSON.parse(raw);
    return db.users ? db : { users: {} };
  } catch {
    return { users: {} };
  }
}
function saveDb(db) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2), "utf8");
}
function defaultUser(passwordHash) {
  return {
    passwordHash,
    plan: "Premium",
    webhookUrl: "",
    message: "Hello! This is your automatic 24-hour message.",
    intervalHours: 24,
    isRunning: false,
    nextSendAt: null,
    lastSentAt: null,
    theme: "Midnight",
    stats: { totalSent: 0 },
    discord: {
      connected: false,
      id: "",
      username: "",
      globalName: "",
      avatar: ""
    }
  };
}
function safeUser(username, user) {
  return {
    username,
    plan: user.plan || "Premium",
    webhookUrl: user.webhookUrl || "",
    message: user.message || "",
    intervalHours: Number(user.intervalHours || 24),
    isRunning: !!user.isRunning,
    nextSendAt: user.nextSendAt || null,
    lastSentAt: user.lastSentAt || null,
    theme: user.theme || "Midnight",
    stats: { totalSent: Number(user.stats?.totalSent || 0) },
    discord: {
      connected: !!user.discord?.connected,
      id: user.discord?.id || "",
      username: user.discord?.username || "",
      globalName: user.discord?.globalName || "",
      avatar: user.discord?.avatar || ""
    }
  };
}
function webhookOk(url) {
  return /^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(String(url || "").trim());
}
async function postToDiscord(webhookUrl, message, files = []) {
  const cleanUrl = String(webhookUrl || "").trim();
  const cleanMessage = String(message || "").trim();
  if (!cleanUrl) return { success: false, message: "Webhook URL is empty." };
  if (!webhookOk(cleanUrl)) return { success: false, message: "Webhook URL looks invalid." };
  if (!cleanMessage && files.length === 0) return { success: false, message: "Message cannot be empty if no file is uploaded." };
  if (cleanMessage.length > 2000) return { success: false, message: "Discord message limit is 2000 characters." };

  try {
    if (files.length > 0) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify({
        content: cleanMessage,
        allowed_mentions: { parse: ["everyone"] }
      }));

      files.forEach((file, index) => {
        form.append(`files[${index}]`, fs.createReadStream(file.path), {
          filename: file.originalname || path.basename(file.path),
          contentType: file.mimetype || "application/octet-stream"
        });
      });

      const response = await axios.post(cleanUrl, form, {
        headers: form.getHeaders(),
        timeout: 30000,
        validateStatus: () => true,
        maxBodyLength: Infinity
      });

      if (response.status < 200 || response.status >= 300) {
        return { success: false, message: "Discord rejected the message: " + (response.data?.message || response.status) };
      }

      return { success: true, message: "Media message sent successfully." };
    }

    const response = await axios.post(
      cleanUrl,
      { content: cleanMessage, allowed_mentions: { parse: ["everyone"] } },
      { headers: { "Content-Type": "application/json" }, timeout: 15000, validateStatus: () => true }
    );

    if (response.status < 200 || response.status >= 300) {
      return { success: false, message: "Discord rejected the message: " + (response.data?.message || response.status) };
    }

    return { success: true, message: "Message sent successfully." };
  } catch (error) {
    return { success: false, message: "Could not send to Discord: " + (error.message || "Unknown error") };
  }
}
function clearTimer(username) {
  const t = timers.get(username);
  if (t) { clearTimeout(t); timers.delete(username); }
}
function scheduleNext(username) {
  clearTimer(username);
  const db = loadDb();
  const user = db.users[username];
  if (!user || !user.isRunning || !user.nextSendAt) return;
  const delay = new Date(user.nextSendAt).getTime() - Date.now();
  if (delay <= 0) return sendScheduled(username);
  const t = setTimeout(() => sendScheduled(username), delay);
  timers.set(username, t);
}
async function sendScheduled(username) {
  const db = loadDb();
  const user = db.users[username];
  if (!user || !user.isRunning) return;
  const result = await postToDiscord(user.webhookUrl, user.message);
  if (!result.success) return;
  const now = new Date();
  user.lastSentAt = now.toISOString();
  user.nextSendAt = new Date(now.getTime() + Number(user.intervalHours || 24) * 60 * 60 * 1000).toISOString();
  user.stats.totalSent = Number(user.stats?.totalSent || 0) + 1;
  db.users[username] = user;
  saveDb(db);
  scheduleNext(username);
}
function requireAuth(req, res, next) {
  if (!req.session.username) return res.status(401).json({ success: false, message: "Please log in first." });
  next();
}

app.post("/api/register", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!username || username.length < 3) return res.status(400).json({ success: false, message: "Username must be at least 3 characters." });
  if (!/^[a-z0-9_.-]+$/i.test(username)) return res.status(400).json({ success: false, message: "Username can only use letters, numbers, dot, dash, or underscore." });
  if (!password || password.length < 4) return res.status(400).json({ success: false, message: "Password must be at least 4 characters." });
  const db = loadDb();
  if (db.users[username]) return res.status(400).json({ success: false, message: "This username already exists." });
  db.users[username] = defaultUser(await bcrypt.hash(password, 10));
  saveDb(db);
  req.session.username = username;
  res.json({ success: true, message: "Account created.", user: safeUser(username, db.users[username]) });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const db = loadDb();
  const user = db.users[username];
  if (!user) return res.status(400).json({ success: false, message: "User not found." });
  if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ success: false, message: "Wrong password." });
  req.session.username = username;
  res.json({ success: true, message: "Logged in.", user: safeUser(username, user) });
});

app.post("/api/logout", requireAuth, (req, res) => req.session.destroy(() => res.json({ success: true, message: "Logged out." })));

app.get("/api/me", (req, res) => {
  if (!req.session.username) return res.json({ loggedIn: false, discordConfigured: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET) });
  const db = loadDb();
  const user = db.users[req.session.username];
  if (!user) return res.json({ loggedIn: false, discordConfigured: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET) });
  res.json({ loggedIn: true, discordConfigured: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET), user: safeUser(req.session.username, user) });
});

app.get("/api/user-settings", requireAuth, (req, res) => {
  const db = loadDb();
  res.json({ success: true, user: safeUser(req.session.username, db.users[req.session.username]) });
});

app.post("/api/user-settings", requireAuth, (req, res) => {
  const db = loadDb();
  const user = db.users[req.session.username];
  user.webhookUrl = typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl.trim() : user.webhookUrl;
  user.message = typeof req.body?.message === "string" ? req.body.message : user.message;
  user.theme = typeof req.body?.theme === "string" ? req.body.theme : user.theme;
  const parsed = Number(req.body?.intervalHours);
  user.intervalHours = Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
  db.users[req.session.username] = user;
  saveDb(db);
  res.json({ success: true, message: "Settings saved.", user: safeUser(req.session.username, user) });
});

app.post("/api/start", requireAuth, (req, res) => {
  const db = loadDb(); const user = db.users[req.session.username];
  if (!user.webhookUrl.trim()) return res.status(400).json({ success: false, message: "Please enter a webhook URL first." });
  if (!user.message.trim()) return res.status(400).json({ success: false, message: "Please enter a message first." });
  user.isRunning = true;
  user.nextSendAt = new Date(Date.now() + Number(user.intervalHours || 24) * 60 * 60 * 1000).toISOString();
  db.users[req.session.username] = user;
  saveDb(db);
  scheduleNext(req.session.username);
  res.json({ success: true, message: "Scheduler started.", user: safeUser(req.session.username, user) });
});

app.post("/api/stop", requireAuth, (req, res) => {
  const db = loadDb(); const user = db.users[req.session.username];
  user.isRunning = false; user.nextSendAt = null;
  db.users[req.session.username] = user; saveDb(db); clearTimer(req.session.username);
  res.json({ success: true, message: "Scheduler stopped.", user: safeUser(req.session.username, user) });
});

app.post("/api/test", requireAuth, async (req, res) => {
  const db = loadDb(); const user = db.users[req.session.username];
  const result = await postToDiscord(user.webhookUrl, user.message);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post("/api/send-now", requireAuth, async (req, res) => {
  const db = loadDb(); const user = db.users[req.session.username];
  const result = await postToDiscord(user.webhookUrl, user.message);
  if (!result.success) return res.status(400).json(result);
  user.lastSentAt = new Date().toISOString();
  user.stats.totalSent = Number(user.stats?.totalSent || 0) + 1;
  if (user.isRunning) user.nextSendAt = new Date(Date.now() + Number(user.intervalHours || 24) * 60 * 60 * 1000).toISOString();
  db.users[req.session.username] = user; saveDb(db); if (user.isRunning) scheduleNext(req.session.username);
  res.json({ success: true, message: "Message sent immediately.", user: safeUser(req.session.username, user) });
});

app.post("/api/upload-send", requireAuth, upload.array("media", 10), async (req, res) => {
  const db = loadDb(); const user = db.users[req.session.username]; const files = req.files || [];
  const result = await postToDiscord(user.webhookUrl, req.body?.message || user.message || "", files);
  files.forEach((file) => { if (file?.path && fs.existsSync(file.path)) fs.unlink(file.path, () => {}); });
  if (!result.success) return res.status(400).json(result);
  user.lastSentAt = new Date().toISOString();
  user.stats.totalSent = Number(user.stats?.totalSent || 0) + 1;
  db.users[req.session.username] = user; saveDb(db);
  res.json({ success: true, message: "Media message sent successfully.", user: safeUser(req.session.username, user) });
});

app.get("/auth/discord", requireAuth, (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.redirect("/?discord_oauth_missing=1");
  }
  const state = Math.random().toString(36).slice(2);
  req.session.discordState = state;
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: DISCORD_REDIRECT_URI,
    scope: "identify",
    prompt: "consent",
    state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", requireAuth, async (req, res) => {
  try {
    if (!req.query.code || !req.query.state || req.query.state !== req.session.discordState) {
      return res.redirect("/?discord_connect=failed");
    }

    const tokenRes = await axios.post("https://discord.com/api/oauth2/token", new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: String(req.query.code),
      redirect_uri: DISCORD_REDIRECT_URI
    }).toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const accessToken = tokenRes.data.access_token;
    const meRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const me = meRes.data;
    const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : "";
    const db = loadDb();
    const user = db.users[req.session.username];
    user.discord = {
      connected: true,
      id: me.id || "",
      username: me.username || "",
      globalName: me.global_name || "",
      avatar
    };
    db.users[req.session.username] = user;
    saveDb(db);

    res.redirect("/?discord_connect=success");
  } catch (error) {
    res.redirect("/?discord_connect=failed");
  }
});

app.listen(PORT, () => {
  const db = loadDb();
  Object.keys(db.users).forEach((username) => {
    if (db.users[username].isRunning && db.users[username].nextSendAt) scheduleNext(username);
  });
  console.log(`Server is running on http://localhost:${PORT}`);
});
