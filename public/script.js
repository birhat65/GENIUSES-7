const authView = document.getElementById("authView");
const dashboardView = document.getElementById("dashboardView");
const messageBoxEl = document.getElementById("messageBox");
const usernameLabel = document.getElementById("usernameLabel");
const webhookUrlEl = document.getElementById("webhookUrl");
const messageEl = document.getElementById("message");
const intervalHoursEl = document.getElementById("intervalHours");
const statusEl = document.getElementById("status");
const liveDotEl = document.getElementById("liveDot");
const lastSentAtEl = document.getElementById("lastSentAt");
const nextSendAtEl = document.getElementById("nextSendAt");

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function showMessage(text, isError = false) {
  messageBoxEl.textContent = text;
  messageBoxEl.classList.remove("hidden");
  messageBoxEl.style.background = isError ? "rgba(185, 28, 28, 0.88)" : "rgba(37, 99, 235, 0.84)";
}

function updateLiveState(isRunning) {
  statusEl.textContent = isRunning ? "Running" : "Stopped";
  liveDotEl.classList.remove("active", "stopped");
  liveDotEl.classList.add(isRunning ? "active" : "stopped");
}

function fillDashboard(user) {
  usernameLabel.textContent = user.username || "-";
  webhookUrlEl.value = user.webhookUrl || "";
  messageEl.value = user.message || "";
  intervalHoursEl.value = user.intervalHours || 24;
  updateLiveState(!!user.isRunning);
  lastSentAtEl.textContent = formatDate(user.lastSentAt);
  nextSendAtEl.textContent = formatDate(user.nextSendAt);
}

function setLoggedIn(loggedIn) {
  authView.classList.toggle("hidden", loggedIn);
  dashboardView.classList.toggle("hidden", !loggedIn);
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

async function checkSession() {
  const { data } = await api("/api/me");
  if (data.loggedIn) {
    setLoggedIn(true);
    fillDashboard(data.user);
  } else {
    setLoggedIn(false);
  }
}

async function registerUser() {
  const username = document.getElementById("registerUsername").value.trim();
  const password = document.getElementById("registerPassword").value;

  const { ok, data } = await api("/api/register", "POST", { username, password });
  showMessage(data.message, !ok);

  if (ok) {
    setLoggedIn(true);
    fillDashboard(data.user);
  }
}

async function loginUser() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;

  const { ok, data } = await api("/api/login", "POST", { username, password });
  showMessage(data.message, !ok);

  if (ok) {
    setLoggedIn(true);
    fillDashboard(data.user);
  }
}

async function logoutUser() {
  const { ok, data } = await api("/api/logout", "POST");
  showMessage(data.message || "Logged out.", !ok);
  setLoggedIn(false);
}

async function saveSettings(showOk = true) {
  const { ok, data } = await api("/api/user-settings", "POST", {
    webhookUrl: webhookUrlEl.value,
    message: messageEl.value,
    intervalHours: Number(intervalHoursEl.value || 24)
  });

  if (showOk || !ok) {
    showMessage(data.message || (ok ? "Settings saved." : "Could not save settings."), !ok);
  }
  if (ok) fillDashboard(data.user);
}

async function refreshSettings() {
  const { ok, data } = await api("/api/user-settings");
  if (ok) fillDashboard(data.user);
}

async function startScheduler() {
  await saveSettings(false);
  const { ok, data } = await api("/api/start", "POST");
  showMessage(data.message || (ok ? "Scheduler started." : "Could not start."), !ok);
  if (ok) fillDashboard(data.user);
}

async function stopScheduler() {
  const { ok, data } = await api("/api/stop", "POST");
  showMessage(data.message || (ok ? "Scheduler stopped." : "Could not stop."), !ok);
  if (ok) fillDashboard(data.user);
}

async function testSend() {
  await saveSettings(false);
  const { ok, data } = await api("/api/test", "POST");
  showMessage(data.message || (ok ? "Test sent." : "An error occurred."), !ok);
  await refreshSettings();
}

async function sendNow() {
  await saveSettings(false);
  const { ok, data } = await api("/api/send-now", "POST");
  showMessage(data.message || (ok ? "Message sent." : "An error occurred."), !ok);
  if (ok) fillDashboard(data.user);
}

document.getElementById("registerBtn").addEventListener("click", registerUser);
document.getElementById("loginBtn").addEventListener("click", loginUser);
document.getElementById("logoutBtn").addEventListener("click", logoutUser);
document.getElementById("saveBtn").addEventListener("click", () => saveSettings(true));
document.getElementById("startBtn").addEventListener("click", startScheduler);
document.getElementById("stopBtn").addEventListener("click", stopScheduler);
document.getElementById("testBtn").addEventListener("click", testSend);
document.getElementById("sendNowBtn").addEventListener("click", sendNow);

checkSession();
setInterval(refreshSettings, 15000);
