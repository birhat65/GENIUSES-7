const authView = document.getElementById("authView");
const dashboardView = document.getElementById("dashboardView");
const messageBoxEl = document.getElementById("messageBox");
const usernameLabel = document.getElementById("usernameLabel");
const planLabel = document.getElementById("planLabel");
const welcomeTitle = document.getElementById("welcomeTitle");
const statusTextTop = document.getElementById("statusTextTop");
const webhookUrlEl = document.getElementById("webhookUrl");
const messageEl = document.getElementById("message");
const mediaMessageEl = document.getElementById("mediaMessage");
const imageFilesEl = document.getElementById("imageFiles");
const videoFilesEl = document.getElementById("videoFiles");
const intervalHoursEl = document.getElementById("intervalHours");
const statusEl = document.getElementById("status");
const liveDotEl = document.getElementById("liveDot");
const lastSentAtEl = document.getElementById("lastSentAt");
const nextSendAtEl = document.getElementById("nextSendAt");
const totalSentEl = document.getElementById("totalSent");
const themeSelect = document.getElementById("themeSelect");
const brandMark = document.getElementById("brandMark");
const discordStatus = document.getElementById("discordStatus");
const connectDiscordBtn = document.getElementById("connectDiscordBtn");
const botTokenEl = document.getElementById("botToken");
const adChannelIdEl = document.getElementById("adChannelId");
const adChannelSelectEl = document.getElementById("adChannelSelect");
const refreshBotChannelsBtn = document.getElementById("refreshBotChannelsBtn");
const tagTriggerEl = document.getElementById("tagTrigger");
const adTriggerEl = document.getElementById("adTrigger");
const dmMessageEl = document.getElementById("dmMessage");
const botVideoEl = document.getElementById("botVideo");
const botVideoNameEl = document.getElementById("botVideoName");
const botStatusBadge = document.getElementById("botStatusBadge");

let botTokenTouched = false;
let botPanelDirty = false;

function formatDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}
function showMessage(t, e = false) {
  messageBoxEl.textContent = t;
  messageBoxEl.classList.remove("hidden");
  messageBoxEl.style.background = e ? "rgba(185, 28, 28, 0.88)" : "rgba(37, 99, 235, 0.84)";
}
function updateLiveState(r) {
  const l = r ? "Running" : "Stopped";
  statusEl.textContent = l;
  statusTextTop.textContent = l;
  liveDotEl.classList.remove("active", "stopped");
  liveDotEl.classList.add(r ? "active" : "stopped");
}
function setTheme(theme) {
  const t = String(theme || "Midnight").toLowerCase();
  const v = t === "neon" ? "neon" : t === "crimson" ? "crimson" : "midnight";
  document.body.setAttribute("data-theme", v);
  themeSelect.value = v.charAt(0).toUpperCase() + v.slice(1);
}
function setAvatar(discord) {
  if (discord?.connected && discord.avatar) {
    brandMark.style.backgroundImage = `url('${discord.avatar}')`;
    brandMark.textContent = "";
  } else {
    brandMark.style.backgroundImage = "";
    brandMark.textContent = "BH";
  }
  discordStatus.textContent = discord?.connected ? `Connected: ${discord.globalName || discord.username}` : "Discord not connected";
}
function setLoggedIn(v) {
  authView.classList.toggle("hidden", v);
  dashboardView.classList.toggle("hidden", !v);
}
async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

function fillDashboard(u) {
  usernameLabel.textContent = u.username || "-";
  planLabel.textContent = u.plan || "Premium";
  welcomeTitle.textContent = `Welcome, ${u.username || "User"}`;
  webhookUrlEl.value = u.webhookUrl || "";
  messageEl.value = u.message || "";
  mediaMessageEl.value = u.message || "";
  intervalHoursEl.value = u.intervalHours || 24;
  totalSentEl.textContent = u.stats?.totalSent ?? 0;
  updateLiveState(!!u.isRunning);
  lastSentAtEl.textContent = formatDate(u.lastSentAt);
  nextSendAtEl.textContent = formatDate(u.nextSendAt);
  setTheme(u.theme || "Midnight");
  setAvatar(u.discord);
  fillBotPanel(u.botPanel || {});
}

function fillBotPanel(b) {
  if (!botStatusBadge) return;

  // Do not erase the token while the user is typing or after it has been typed.
  if (!botTokenTouched && document.activeElement !== botTokenEl && !botTokenEl.value) {
    botTokenEl.value = "";
  }
  botTokenEl.placeholder = b.tokenSaved ? "Token saved. If you do not enter a new token, the old token stays active." : "Paste bot token here.";

  if (!botPanelDirty || document.activeElement !== adChannelIdEl) adChannelIdEl.value = b.adChannelId || adChannelIdEl.value || "";
  if (!botPanelDirty || document.activeElement !== tagTriggerEl) tagTriggerEl.value = b.tagTrigger || "tag";
  if (!botPanelDirty || document.activeElement !== adTriggerEl) adTriggerEl.value = b.adTrigger || "reklam";
  if (!botPanelDirty || document.activeElement !== dmMessageEl) dmMessageEl.value = b.dmMessage || "Send me your Discord server invite link.";

  if (adChannelSelectEl && b.adChannelId) adChannelSelectEl.value = b.adChannelId;
  botVideoNameEl.textContent = b.videoName ? `Uploaded video: ${b.videoName}` : "No video uploaded yet.";
  botStatusBadge.textContent = b.running ? "Bot running" : "Bot stopped";
  botStatusBadge.title = b.lastError || "";
}

async function refreshBotChannels() {
  if (!adChannelSelectEl) return;
  const current = adChannelIdEl.value.trim();
  const { ok, data } = await api("/api/bot-channels");
  adChannelSelectEl.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = ok ? "Select an ad channel" : "Bot is not ready or the token is invalid";
  adChannelSelectEl.appendChild(first);
  (data.channels || []).forEach((ch) => {
    const option = document.createElement("option");
    option.value = ch.id;
    option.textContent = `${ch.guild} / ${ch.name}`;
    adChannelSelectEl.appendChild(option);
  });
  if (current) adChannelSelectEl.value = current;
  if (!ok) showMessage(data.message || "Could not load channels. Save the token and start the bot first.", true);
}

async function checkSession() {
  const { data } = await api("/api/me");
  const qs = new URLSearchParams(location.search);
  if (qs.get("discord_connect") === "success") showMessage("Discord account connected.");
  if (qs.get("discord_connect") === "failed") showMessage("Discord account connection failed.", true);
  if (qs.get("discord_oauth_missing") === "1") showMessage("Discord OAuth is not configured yet. Add the Discord env values first.", true);
  if (data.loggedIn) {
    setLoggedIn(true);
    fillDashboard(data.user);
    refreshBotChannels();
  } else setLoggedIn(false);
}
async function registerUser() {
  const username = document.getElementById("registerUsername").value.trim();
  const password = document.getElementById("registerPassword").value;
  const { ok, data } = await api("/api/register", "POST", { username, password });
  showMessage(data.message, !ok);
  if (ok) { setLoggedIn(true); fillDashboard(data.user); }
}
async function loginUser() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const { ok, data } = await api("/api/login", "POST", { username, password });
  showMessage(data.message, !ok);
  if (ok) { setLoggedIn(true); fillDashboard(data.user); refreshBotChannels(); }
}
async function logoutUser() {
  const { ok, data } = await api("/api/logout", "POST");
  showMessage(data.message || "Logged out.", !ok);
  setLoggedIn(false);
  setAvatar(null);
}
async function saveSettings(showOk = true) {
  const { ok, data } = await api("/api/user-settings", "POST", {
    webhookUrl: webhookUrlEl.value,
    message: messageEl.value,
    intervalHours: Number(intervalHoursEl.value || 24),
    theme: themeSelect.value
  });
  (showOk || !ok) && showMessage(data.message || (ok ? "Settings saved." : "Could not save settings."), !ok);
  ok && fillDashboard(data.user);
}
async function refreshSettings() {
  // While editing bot panel, do not overwrite token/channel fields.
  const { ok, data } = await api("/api/user-settings");
  ok && fillDashboard(data.user);
}
async function startScheduler() { await saveSettings(false); const { ok, data } = await api("/api/start", "POST"); showMessage(data.message || (ok ? "Scheduler started." : "Could not start."), !ok); ok && fillDashboard(data.user); }
async function stopScheduler() { const { ok, data } = await api("/api/stop", "POST"); showMessage(data.message || (ok ? "Scheduler stopped." : "Could not stop."), !ok); ok && fillDashboard(data.user); }
async function testSend() { await saveSettings(false); const { ok, data } = await api("/api/test", "POST"); showMessage(data.message || (ok ? "Test sent." : "An error occurred."), !ok); await refreshSettings(); }
async function sendNow() { await saveSettings(false); const { ok, data } = await api("/api/send-now", "POST"); showMessage(data.message || (ok ? "Message sent." : "An error occurred."), !ok); ok && fillDashboard(data.user); }
async function sendMediaNow() {
  await saveSettings(false);
  const allFiles = [...imageFilesEl.files, ...videoFilesEl.files];
  if (allFiles.length === 0) { showMessage("Please choose images or videos first.", true); return; }
  if (allFiles.length > 10) { showMessage("You can upload up to 10 files at once.", true); return; }
  const form = new FormData();
  allFiles.forEach(file => form.append("media", file));
  form.append("message", mediaMessageEl.value || messageEl.value || "");
  const res = await fetch("/api/upload-send", { method: "POST", body: form });
  const data = await res.json();
  showMessage(data.message || (res.ok ? "Media sent." : "Could not send media."), !res.ok);
  if (res.ok && data.user) { fillDashboard(data.user); imageFilesEl.value = ""; videoFilesEl.value = ""; }
}
async function saveBotPanel() {
  const body = {
    botToken: botTokenEl.value.trim(),
    adChannelId: adChannelIdEl.value.trim(),
    tagTrigger: tagTriggerEl.value,
    adTrigger: adTriggerEl.value,
    dmMessage: dmMessageEl.value
  };
  const { ok, data } = await api("/api/bot-panel", "POST", body);
  showMessage(data.message || (ok ? "Bot panel saved." : "Bot panel error."), !ok);
  if (data.user) {
    botTokenTouched = false;
    botPanelDirty = false;
    botTokenEl.value = "";
    fillDashboard(data.user);
    refreshBotChannels();
  }
}
async function uploadBotVideo() {
  if (!botVideoEl.files.length) { showMessage("Please choose a bot video first.", true); return; }
  const form = new FormData();
  form.append("botVideo", botVideoEl.files[0]);
  const res = await fetch("/api/bot-video", { method: "POST", body: form });
  const data = await res.json();
  showMessage(data.message || (res.ok ? "Bot video uploaded." : "Could not upload bot video."), !res.ok);
  if (res.ok && data.user) { fillDashboard(data.user); botVideoEl.value = ""; }
}
async function stopBotPanel() {
  const { ok, data } = await api("/api/bot-stop", "POST");
  showMessage(data.message || (ok ? "Bot stopped." : "Could not stop bot."), !ok);
  if (data.user) fillDashboard(data.user);
}
function connectDiscord() { window.location.href = "/auth/discord"; }

[botTokenEl, adChannelIdEl, tagTriggerEl, adTriggerEl, dmMessageEl].forEach((el) => {
  if (!el) return;
  el.addEventListener("input", () => {
    botPanelDirty = true;
    if (el === botTokenEl) botTokenTouched = true;
  });
});
if (adChannelSelectEl) {
  adChannelSelectEl.addEventListener("change", () => {
    if (adChannelSelectEl.value) {
      adChannelIdEl.value = adChannelSelectEl.value;
      botPanelDirty = true;
    }
  });
}

if (refreshBotChannelsBtn) refreshBotChannelsBtn.addEventListener("click", refreshBotChannels);
document.getElementById("registerBtn").addEventListener("click", registerUser);
document.getElementById("loginBtn").addEventListener("click", loginUser);
document.getElementById("logoutBtn").addEventListener("click", logoutUser);
document.getElementById("saveBtn").addEventListener("click", () => saveSettings(true));
document.getElementById("startBtn").addEventListener("click", startScheduler);
document.getElementById("stopBtn").addEventListener("click", stopScheduler);
document.getElementById("testBtn").addEventListener("click", testSend);
document.getElementById("sendNowBtn").addEventListener("click", sendNow);
document.getElementById("uploadSendBtn").addEventListener("click", sendMediaNow);
themeSelect.addEventListener("change", () => setTheme(themeSelect.value));
connectDiscordBtn.addEventListener("click", connectDiscord);
document.getElementById("saveBotPanelBtn").addEventListener("click", saveBotPanel);
document.getElementById("uploadBotVideoBtn").addEventListener("click", uploadBotVideo);
document.getElementById("stopBotPanelBtn").addEventListener("click", stopBotPanel);
checkSession();
setInterval(refreshSettings, 15000);
