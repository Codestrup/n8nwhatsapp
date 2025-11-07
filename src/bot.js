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

// 🌍 ENVIRONMENT VARIABLES
const GROUP_IDS = (process.env.GROUP_IDS || process.env.GROUP_ID || "").split(",");
const AFFILIATE_ID = process.env.AFFILIATE_ID || "";
const PORT = process.env.PORT || 8080;

// 🧠 GLOBALS
let clientGlobal = null;
let qrRef = { code: null, connected: false };

// 🟢 EXPRESS INITIALIZATION
const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "frontend")));

// ------------------------------------------------------
// HOME + QR STATUS + GROUPS LIST
// ------------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// QR STATUS API
app.get("/api/qr", (req, res) => {
  if (qrRef.connected) return res.json({ status: "connected" });
  if (qrRef.code) return res.json({ status: "qr", qr: qrRef.code });
  return res.json({ status: "waiting" });
});

// GROUP LIST API
app.get("/api/groups", async (req, res) => {
  try {
    if (!clientGlobal)
      return res.status(400).json({ error: "❌ WhatsApp not connected" });

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

// ------------------------------------------------------
// UNIVERSAL MESSAGE API (For n8n / Postman / AI Agent)
// ------------------------------------------------------

app.post("/api/send", async (req, res) => {
  try {
    if (!clientGlobal)
      return res.status(400).json({ error: "❌ WhatsApp not connected" });

    const isReady = await clientGlobal.isConnected();
    if (!isReady)
      return res.status(400).json({ error: "⚠️ WhatsApp not ready yet" });

    const body = req.body || {};
    const groups = body.groupIds || GROUP_IDS;
    const message = body.message || "🔥 Loot Deal Alert! Don’t miss this one 💥";
    const imageUrl = body.image || null;
    const productLink = body.link || "https://amzn.to/trendingdeal";
    const urgencyLine =
      body.urgency ||
      "⏰ Limited Stock – Offer ending soon! Grab before it’s gone!";

    if (!groups || groups.length === 0)
      return res.status(400).json({ error: "⚠️ No group IDs provided" });

    const axios = (await import("axios")).default;

    // 🧩 FOMO Message Builder
    const formattedMessage = `
💥 *Exclusive Offer Alert!* 💥

${message}

${urgencyLine}

🔥 _Best Price Ever!_  
🛒 *Buy Now:* ${productLink}

📦 _Trusted by thousands of smart shoppers._  
💰 Don’t wait — this deal won’t last long!
`;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const chatId = group.includes("@g.us") ? group.trim() : `${group.trim()}@g.us`;

      log.info(`📨 Sending message to ${chatId}`);

      if (imageUrl) {
        try {
          const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
          const base64Image = `data:image/jpeg;base64,${Buffer.from(
            response.data
          ).toString("base64")}`;
          await clientGlobal.sendImageFromBase64(
            chatId,
            base64Image,
            "deal.jpg",
            formattedMessage
          );
        } catch (err) {
          log.warn(`⚠️ Image failed, sending text instead to ${chatId}`);
          await clientGlobal.sendText(chatId, formattedMessage);
        }
      } else {
        await clientGlobal.sendText(chatId, formattedMessage);
      }

      log.success(`✅ Message sent successfully to ${chatId}`);

      // 🕒 Delay between group sends to avoid ban
      const delay = 2000 + Math.floor(Math.random() * 2000);
      log.info(`⏳ Waiting ${delay / 1000}s before next message...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    res.json({ ok: true, message: "✅ All messages sent successfully!" });
  } catch (err) {
    console.error("❌ FULL Send Error =>", err);
    res.status(500).json({ error: err?.message || err.toString() });
  }
});

// ------------------------------------------------------
// EXPRESS SERVER START
// ------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  log.info(`🌐 Dashboard live at http://localhost:${PORT}`);
});

// ------------------------------------------------------
// WPPConnect WhatsApp INITIALIZATION
// ------------------------------------------------------

(async () => {
  try {
    log.info("⏳ Initializing WhatsApp session...");

    const client = await wppconnect.create({
      session: "LootAlertStable",
      headless: "new",
      logQR: false,
      protocolTimeout: 120000,
      restartOnCrash: true, // ✅ Auto restart if browser crashes
      autoClose: false,
      catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
        qrRef.code = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
          urlCode
        )}&size=300x300`;
        log.info("📱 QR Code ready — open dashboard and scan it with WhatsApp");
      },
      puppeteerOptions: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
          "--single-process",
          "--disable-software-rasterizer",
          "--window-size=800,600",
        ],
        defaultViewport: null,
      },
      onLoadingScreen: (percent, message) =>
        log.info(`Loading... ${percent}% - ${message}`),
      onStateChange: (state) => {
        log.info(`📲 WhatsApp state: ${state}`);
        if (state === "DISCONNECTED") {
          log.warn("⚠️ Disconnected! Trying to reconnect...");
        }
      },
      onConnected: () => log.success("✅ WhatsApp session active!"),
      onLogout: () => log.warn("🚪 WhatsApp logged out, please rescan QR!"),
    });

    clientGlobal = client;
    qrRef.connected = true;

    log.success("✅ WhatsApp connected successfully and ready to send!");

    // Auto-list groups
    const groups = await client.listChats({ onlyGroups: true });
    groups.forEach((g) =>
      console.log(`📢 ${g.name || "Unnamed Group"} — ${g.id._serialized}`)
    );

    // Startup test message
    const axios = (await import("axios")).default;
    const sampleCaption = createMessage(sampleDeal, AFFILIATE_ID);
    const response = await axios.get(sampleDeal.image, { responseType: "arraybuffer" });
    const base64Image = `data:image/jpeg;base64,${Buffer.from(
      response.data
    ).toString("base64")}`;

    const chatId = GROUP_IDS[0]?.includes("@g.us")
      ? GROUP_IDS[0]
      : `${GROUP_IDS[0]}@g.us`;

    log.info("🕒 Waiting few seconds to ensure WhatsApp ready...");
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const ready = await client.isConnected();
    if (ready) {
      log.info(`📨 Sending startup message to ${chatId}`);
      await client.sendImageFromBase64(chatId, base64Image, "deal.jpg", sampleCaption);
      log.success("🚀 Startup test message sent successfully!");
    } else {
      log.warn("⚠️ WhatsApp not ready — skipped startup message.");
    }
  } catch (err) {
    console.error("❌ FULL Init Error =>", err);
  }
})();

// ------------------------------------------------------
// END OF FILE
// ------------------------------------------------------
