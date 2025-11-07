import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import wppconnect from "@wppconnect-team/wppconnect";
import * as dotenv from "dotenv";
import { log } from "./utils/logger.js";
import { sampleDeal, createMessage } from "./message-sample.js";
import { createApi } from "./api.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GROUP_IDS = (process.env.GROUP_IDS || process.env.GROUP_ID || "")
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);

const AFFILIATE_ID = process.env.AFFILIATE_ID;
const PORT = process.env.PORT || 8080;

let clientGlobal = null;
let qrRef = { code: null, connected: false };

// 🟢 EXPRESS + FRONTEND INITIALIZATION
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

// --------- ROUTES ---------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// Return QR / Connection Status
app.get("/api/qr", (req, res) => {
  if (qrRef.connected) {
    return res.json({ status: "connected" });
  } else if (qrRef.code) {
    return res.json({ status: "qr", qr: qrRef.code });
  } else {
    return res.json({ status: "waiting" });
  }
});

// 🧩 Route: Get all Group IDs
app.get("/api/groups", async (req, res) => {
  try {
    if (!clientGlobal)
      return res.status(400).json({ error: "WhatsApp not connected" });

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

// ✅ FIXED: Send dynamic message to 1 or multiple groups
app.post("/api/send", async (req, res) => {
  try {
    if (!clientGlobal)
      return res.status(400).json({ error: "❌ WhatsApp not connected" });

    const isReady = await clientGlobal.isConnected();
    if (!isReady)
      return res
        .status(400)
        .json({ error: "⚠️ WhatsApp not ready yet. Try again later." });

    const { groupIds, deal, message, image } = req.body;

    // ✅ fallback to env groups
    const targetGroups = groupIds && groupIds.length ? groupIds : GROUP_IDS;

    if (!targetGroups.length)
      return res.status(400).json({ error: "No target groups found" });

    // ✅ use deal or message dynamically
    const dealData = deal || sampleDeal;
    const msgText =
      message || createMessage(dealData, AFFILIATE_ID) || "🔥 New Offer Alert!";
    const imgUrl = image || dealData.image || null;

    let base64Image = null;
    if (imgUrl) {
      try {
        const axios = (await import("axios")).default;
        const response = await axios.get(imgUrl, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          },
        });
        base64Image = `data:image/jpeg;base64,${Buffer.from(
          response.data
        ).toString("base64")}`;
      } catch (e) {
        log.warn("⚠️ Could not load image, sending text only.");
      }
    }

    // ✅ Send message to each group with delay (anti-ban safe)
    for (const gid of targetGroups) {
      const chatId = gid.includes("@g.us") ? gid : `${gid}@g.us`;
      log.info(`📨 Sending message to ${chatId}`);

      try {
        if (base64Image)
          await clientGlobal.sendImageFromBase64(
            chatId,
            base64Image,
            "deal.jpg",
            msgText
          );
        else await clientGlobal.sendText(chatId, msgText);

        log.success(`✅ Sent successfully to ${chatId}`);
        await new Promise((r) => setTimeout(r, 2500)); // safe delay 2.5 sec
      } catch (err) {
        log.error(`❌ Send failed for ${chatId}: ${err.message}`);
      }
    }

    res.json({ ok: true, message: "✅ Message sent to all groups!" });
  } catch (err) {
    console.error("❌ FULL Send Error =>", err);
    res.status(500).json({ error: err?.message || err.toString() });
  }
});

// Start Express Server
app.listen(PORT, "0.0.0.0", () => {
  log.info(`🌐 Dashboard available at http://localhost:${PORT}`);
});

// --------- WPPConnect WhatsApp Init ---------
(async () => {
  try {
    log.info("⏳ Initializing WhatsApp session...");

    const client = await wppconnect.create({
      session: "LootAlertStable",
      headless: "new",
      logQR: false,
      protocolTimeout: 120000,
      catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
        qrRef.code = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
          urlCode
        )}&size=300x300`;
        log.info("📱 QR Code ready — open dashboard and scan it with WhatsApp");
      },
      onLoadingScreen: (percent, message) => {
        log.info(`Loading... ${percent}% - ${message}`);
      },
      autoClose: false,
      puppeteerOptions: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
        ],
      },
    });

    clientGlobal = client;
    qrRef.connected = true;
    log.success("✅ WhatsApp connected successfully!");

    const groups = await client.listChats({ onlyGroups: true });
    groups.forEach((g) =>
      console.log(`📢 ${g.name || "Unnamed Group"} — ${g.id._serialized}`)
    );

    // ✅ Startup test message
    const caption = createMessage(sampleDeal, AFFILIATE_ID);
    const axios = (await import("axios")).default;
    const response = await axios.get(sampleDeal.image, {
      responseType: "arraybuffer",
    });
    const base64Image = `data:image/jpeg;base64,${Buffer.from(
      response.data
    ).toString("base64")}`;

    const firstGroup =
      GROUP_IDS.length > 0
        ? GROUP_IDS[0].includes("@g.us")
          ? GROUP_IDS[0]
          : `${GROUP_IDS[0]}@g.us`
        : null;

    if (firstGroup) {
      log.info("🕒 Waiting 3 seconds to ensure WhatsApp ready...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const ready = await client.isConnected();
      if (ready) {
        log.info(`📨 Sending startup message to ${firstGroup}`);
        await client.sendImageFromBase64(
          firstGroup,
          base64Image,
          "deal.jpg",
          caption
        );
        log.success("🚀 Startup test message sent!");
      } else {
        log.warn("⚠️ WhatsApp not fully ready — skipped startup message.");
      }
    }
  } catch (err) {
    console.error("❌ FULL Init Error =>", err);
  }
})();
