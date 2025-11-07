import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import wppconnect from "@wppconnect-team/wppconnect";
import * as dotenv from "dotenv";
import { log } from "./utils/logger.js";
import { sampleDeal, createMessage } from "./message-sample.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GROUP_IDS = (process.env.GROUP_IDS || process.env.GROUP_ID || "").split(",");
const AFFILIATE_ID = process.env.AFFILIATE_ID || "";
const PORT = process.env.PORT || 8080;

let clientGlobal = null;
let qrRef = { code: null, connected: false };

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// ✅ QR status
app.get("/api/qr", (req, res) => {
  if (qrRef.connected) return res.json({ status: "connected" });
  if (qrRef.code) return res.json({ status: "qr", qr: qrRef.code });
  res.json({ status: "waiting" });
});

// ✅ Get all WhatsApp groups
app.get("/api/groups", async (req, res) => {
  try {
    if (!clientGlobal) return res.status(400).json({ error: "❌ WhatsApp not connected" });
    const groups = await clientGlobal.listChats({ onlyGroups: true });
    const formatted = groups.map((g) => ({
      name: g.name || "Unnamed Group",
      id: g.id._serialized,
    }));
    log.info(`📋 Found ${formatted.length} groups.`);
    res.json({ groups: formatted });
  } catch (err) {
    log.error("Group Fetch Error:", err);
    res.status(500).json({ error: err.toString() });
  }
});

// ✅ UNIVERSAL Message Send API (text/image/custom)
app.post("/api/send", async (req, res) => {
  try {
    if (!clientGlobal) return res.status(400).json({ error: "❌ WhatsApp not connected" });
    const isReady = await clientGlobal.isConnected();
    if (!isReady) return res.status(400).json({ error: "⚠️ WhatsApp not ready" });

    const axios = (await import("axios")).default;
    const body = req.body || {};
    const groups = body.groupIds || GROUP_IDS;
    const message = body.message || "🛍️ New Deal Available!";
    const imageUrl = body.image || null;

    if (!groups || groups.length === 0) {
      return res.status(400).json({ error: "⚠️ No group IDs provided" });
    }

    for (let group of groups) {
      const chatId = group.includes("@g.us") ? group.trim() : `${group.trim()}@g.us`;
      log.info(`📨 Sending message to ${chatId}`);

      if (imageUrl) {
        // Convert image to base64
        const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const base64Image = `data:image/jpeg;base64,${Buffer.from(response.data).toString("base64")}`;
        await clientGlobal.sendImageFromBase64(chatId, base64Image, "deal.jpg", message);
      } else {
        await clientGlobal.sendText(chatId, message);
      }

      log.success(`✅ Sent successfully to ${chatId}`);
      await new Promise((resolve) => setTimeout(resolve, 2500)); // delay between groups
    }

    res.json({ ok: true, message: "✅ Message sent to all groups!" });
  } catch (err) {
    console.error("❌ FULL Send Error =>", err);
    res.status(500).json({ error: err?.message || err.toString() });
  }
});

// ✅ Start Express Server
app.listen(PORT, "0.0.0.0", () => {
  log.info(`🌐 Dashboard available at http://localhost:${PORT}`);
});

// ✅ WhatsApp Initialization
(async () => {
  try {
    log.info("⏳ Initializing WhatsApp session...");

    const client = await wppconnect.create({
      session: "LootAlertStable",
      headless: "new",
      logQR: false,
      protocolTimeout: 120000,
      catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
        qrRef.code = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(urlCode)}&size=300x300`;
        log.info("📱 QR Code ready — open dashboard and scan it with WhatsApp");
      },
      onLoadingScreen: (percent, message) => {
        log.info(`Loading... ${percent}% - ${message}`);
      },
      autoClose: false,
      puppeteerOptions: {
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
      },
    });

    clientGlobal = client;
    qrRef.connected = true;
    log.success("✅ WhatsApp connected successfully!");

    // List all groups
    const groups = await client.listChats({ onlyGroups: true });
    groups.forEach((g) => console.log(`📢 ${g.name || "Unnamed Group"} — ${g.id._serialized}`));

    // Send startup test message
    const chatId = GROUP_IDS[0]?.includes("@g.us") ? GROUP_IDS[0] : `${GROUP_IDS[0]}@g.us`;
    const caption = createMessage(sampleDeal, AFFILIATE_ID);
    const axios = (await import("axios")).default;
    const response = await axios.get(sampleDeal.image, { responseType: "arraybuffer" });
    const base64Image = `data:image/jpeg;base64,${Buffer.from(response.data).toString("base64")}`;

    await new Promise((resolve) => setTimeout(resolve, 3000));
    const ready = await client.isConnected();
    if (ready) {
      log.info(`📨 Sending startup message to ${chatId}`);
      await client.sendImageFromBase64(chatId, base64Image, "deal.jpg", caption);
      log.success("🚀 Startup test message sent!");
    } else {
      log.warn("⚠️ WhatsApp not ready — skipped startup message.");
    }
  } catch (err) {
    console.error("❌ FULL Init Error =>", err);
  }
})();
