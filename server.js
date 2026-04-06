const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultSettings = {
  webhookUrl: "",
  message: "Hello! This is your automatic 24-hour message.",
  intervalHours: 24,
  isRunning: false,
  nextSendAt: null,
  lastSentAt: null
};

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), "utf8");
    return { ...defaultSettings };
  }

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch (error) {
    console.error("Could not read settings:", error);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), "utf8");
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

let settings = loadSettings();
let timer = null;

function looksLikeWebhook(url) {
  const clean = (url || "").trim();
  return /^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(clean);
}

async function postToDiscord(webhookUrl, message) {
  const cleanUrl = (webhookUrl || "").trim();
  const cleanMessage = (message || "").trim();

  if (!cleanUrl) {
    return { success: false, message: "Webhook URL is empty." };
  }

  if (!looksLikeWebhook(cleanUrl)) {
    return { success: false, message: "Webhook URL looks invalid." };
  }

  if (!cleanMessage) {
    return { success: false, message: "Message cannot be empty." };
  }

  if (cleanMessage.length > 2000) {
    return { success: false, message: "Discord message limit is 2000 characters." };
  }

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
    return {
      success: false,
      message: "Could not send to Discord: " + (error.message || "Unknown error")
    };
  }
}

async function sendDiscordMessage() {
  if (!settings.webhookUrl || !settings.message || !settings.isRunning) return;

  const result = await postToDiscord(settings.webhookUrl, settings.message);

  if (!result.success) {
    console.error(result.message);
    return;
  }

  const now = new Date();
  settings.lastSentAt = now.toISOString();
  settings.nextSendAt = new Date(now.getTime() + settings.intervalHours * 60 * 60 * 1000).toISOString();
  saveSettings(settings);
  console.log("Message sent:", settings.lastSentAt);
}

function clearCurrentTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNext() {
  clearCurrentTimer();

  if (!settings.isRunning || !settings.nextSendAt) return;

  const delay = new Date(settings.nextSendAt).getTime() - Date.now();

  if (delay <= 0) {
    sendDiscordMessage().finally(() => {
      if (settings.isRunning) scheduleNext();
    });
    return;
  }

  timer = setTimeout(async () => {
    await sendDiscordMessage();
    if (settings.isRunning) scheduleNext();
  }, delay);
}

function startScheduler(sendNow = false) {
  settings.isRunning = true;
  const now = new Date();
  settings.nextSendAt = sendNow
    ? now.toISOString()
    : new Date(now.getTime() + settings.intervalHours * 60 * 60 * 1000).toISOString();

  saveSettings(settings);
  scheduleNext();
}

function stopScheduler() {
  settings.isRunning = false;
  settings.nextSendAt = null;
  saveSettings(settings);
  clearCurrentTimer();
}

app.get("/api/settings", (req, res) => {
  settings = loadSettings();
  res.json(settings);
});

app.post("/api/settings", (req, res) => {
  const { webhookUrl, message, intervalHours } = req.body;

  settings.webhookUrl = typeof webhookUrl === "string" ? webhookUrl.trim() : settings.webhookUrl;
  settings.message = typeof message === "string" ? message : settings.message;

  const parsedInterval = Number(intervalHours);
  settings.intervalHours = Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : 24;

  saveSettings(settings);
  res.json({ success: true, settings });
});

app.post("/api/start", (req, res) => {
  const { sendNow } = req.body || {};

  if (!settings.webhookUrl || !settings.webhookUrl.trim()) {
    return res.status(400).json({ success: false, message: "Please enter a webhook URL first." });
  }

  if (!settings.message || !settings.message.trim()) {
    return res.status(400).json({ success: false, message: "Please enter a message first." });
  }

  startScheduler(Boolean(sendNow));
  res.json({ success: true, settings, message: "Scheduler started." });
});

app.post("/api/stop", (req, res) => {
  stopScheduler();
  res.json({ success: true, settings, message: "Scheduler stopped." });
});

app.post("/api/test", async (req, res) => {
  const webhookUrl = (req.body?.webhookUrl || settings.webhookUrl || "").trim();
  const message = (req.body?.message || settings.message || "Test message").trim();

  const result = await postToDiscord(webhookUrl, message);

  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json(result);
});

app.post("/api/send-now", async (req, res) => {
  const result = await postToDiscord(settings.webhookUrl, settings.message);

  if (!result.success) {
    return res.status(400).json(result);
  }

  const now = new Date();
  settings.lastSentAt = now.toISOString();

  if (settings.isRunning) {
    settings.nextSendAt = new Date(now.getTime() + settings.intervalHours * 60 * 60 * 1000).toISOString();
    saveSettings(settings);
    scheduleNext();
  } else {
    saveSettings(settings);
  }

  res.json({ success: true, settings, message: "Message sent immediately." });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  settings = loadSettings();
  if (settings.isRunning && settings.nextSendAt) {
    scheduleNext();
  }
});
