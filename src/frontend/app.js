const qrImg = document.getElementById("qr");
const statusText = document.getElementById("status");
const testBtn = document.getElementById("testBtn");

async function checkQR() {
  const res = await fetch("/api/qr");
  const data = await res.json();

  if (data.status === "connected") {
    statusText.innerHTML = "✅ WhatsApp Connected!";
    qrImg.style.display = "none";
    testBtn.disabled = false;
  } else if (data.status === "qr") {
    statusText.innerHTML = "📲 Scan QR to connect your WhatsApp";
    qrImg.src = data.qr;
    qrImg.style.display = "block";
  } else {
    statusText.innerHTML = "⏳ Waiting for QR...";
  }
}

async function sendTest() {
  statusText.innerHTML = "Sending test message...";
  const res = await fetch("/api/send", { method: "POST" });
  const data = await res.json();
  if (data.ok) statusText.innerHTML = data.message;
  else statusText.innerHTML = "❌ Failed to send message";
}

testBtn.addEventListener("click", sendTest);
setInterval(checkQR, 2000);