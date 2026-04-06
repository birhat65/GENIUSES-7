const webhookUrlEl = document.getElementById("webhookUrl");
const messageEl = document.getElementById("message");
const intervalHoursEl = document.getElementById("intervalHours");
const statusEl = document.getElementById("status");
const lastSentAtEl = document.getElementById("lastSentAt");
const nextSendAtEl = document.getElementById("nextSendAt");
const messageBoxEl = document.getElementById("messageBox");
const liveDotEl = document.getElementById("liveDot");

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
  if (isRunning) liveDotEl.classList.add("active");
  else liveDotEl.classList.add("stopped");
}

async function loadSettings() {
  const res = await fetch("/api/settings");
  const data = await res.json();
  webhookUrlEl.value = data.webhookUrl || "";
  messageEl.value = data.message || "";
  intervalHoursEl.value = data.intervalHours || 24;
  updateLiveState(data.isRunning);
  lastSentAtEl.textContent = formatDate(data.lastSentAt);
  nextSendAtEl.textContent = formatDate(data.nextSendAt);
}

async function saveSettings(showOk = true) {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookUrl: webhookUrlEl.value,
      message: messageEl.value,
      intervalHours: Number(intervalHoursEl.value || 24)
    })
  });
  const data = await res.json();
  if (data.success) {
    if (showOk) showMessage("Settings saved.");
    await loadSettings();
  } else {
    showMessage("Settings could not be saved.", true);
  }
}

async function testSend() {
  await saveSettings(false);
  const res = await fetch("/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookUrl: webhookUrlEl.value,
      message: messageEl.value || "Test message"
    })
  });
  const data = await res.json();
  showMessage(data.message || (data.success ? "Test sent." : "An error occurred."), !data.success);
  await loadSettings();
}

async function sendNow() {
  await saveSettings(false);
  const res = await fetch("/api/send-now", { method: "POST" });
  const data = await res.json();
  showMessage(data.message || (data.success ? "Message sent." : "An error occurred."), !data.success);
  await loadSettings();
}

async function startScheduler() {
  await saveSettings(false);
  const res = await fetch("/api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sendNow: false })
  });
  const data = await res.json();
  showMessage(data.message || (data.success ? "Scheduler started." : "Could not start."), !data.success);
  await loadSettings();
}

async function stopScheduler() {
  const res = await fetch("/api/stop", { method: "POST" });
  const data = await res.json();
  showMessage(data.message || (data.success ? "Scheduler stopped." : "Could not stop."), !data.success);
  await loadSettings();
}

document.getElementById("saveBtn").addEventListener("click", () => saveSettings(true));
document.getElementById("testBtn").addEventListener("click", testSend);
document.getElementById("sendNowBtn").addEventListener("click", sendNow);
document.getElementById("startBtn").addEventListener("click", startScheduler);
document.getElementById("stopBtn").addEventListener("click", stopScheduler);

loadSettings();
setInterval(loadSettings, 15000);
