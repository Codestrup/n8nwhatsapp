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

const GROUP_ID = process.env.GROUP_ID;
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

// ✅ FIXED: Send test message manually
app.post("/api/send", async (req, res) => {
  try {
    if (!clientGlobal)
      return res.status(400).json({ error: "❌ WhatsApp not connected" });

    const isReady = await clientGlobal.isConnected();
    if (!isReady)
      return res
        .status(400)
        .json({ error: "⚠️ WhatsApp not ready yet. Try again in a few seconds." });

    const image = sampleDeal.image;
    const caption = createMessage(sampleDeal, AFFILIATE_ID);

    // ✅ Proper Base64 Conversion with headers and prefix
    const axios = (await import("axios")).default;
    const response = await axios.get(image, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    let base64Image = `data:image/jpeg;base64,${Buffer.from(
      response.data
    ).toString("base64")}`;

    // ✅ Fallback if image fails or empty
    if (!base64Image || base64Image.length < 500) {
      log.warn("⚠️ Image invalid or too short, using placeholder.");
      const fallback = await axios.get(
        "https://upload.wikimedia.org/wikipedia/commons/3/3f/Placeholder_view_vector.svg",
        { responseType: "arraybuffer" }
      );
      base64Image = `data:image/svg+xml;base64,${Buffer.from(
        fallback.data
      ).toString("base64")}`;
    }

    const chatId = GROUP_ID.includes("@g.us") ? GROUP_ID : `${GROUP_ID}@g.us`;
    log.info(`📨 Sending test message to ${chatId}`);

    await clientGlobal.sendImageFromBase64(
      chatId.toString(),
      base64Image,
      "deal.jpg",
      caption
    );

    log.success("✅ Test message sent successfully!");
    res.json({ ok: true, message: "✅ Test message sent to group!" });
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
      headless: true,
      logQR: false,
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
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    clientGlobal = client;
    qrRef.connected = true;
    log.success("✅ WhatsApp connected successfully!");

    // ✅ Auto-list groups in console
    const groups = await client.listChats({ onlyGroups: true });
    groups.forEach((g) =>
      console.log(`📢 ${g.name || "Unnamed Group"} — ${g.id._serialized}`)
    );

    // ✅ Startup message (wait for WhatsApp sync)
    const caption = createMessage(sampleDeal, AFFILIATE_ID);
    const axios = (await import("axios")).default;
    const response = await axios.get(sampleDeal.image, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    let base64Image = `data:image/jpeg;base64,${Buffer.from(
      response.data
    ).toString("base64")}`;

    if (!base64Image || base64Image.length < 500) {
      log.warn("⚠️ Image invalid, using fallback placeholder.");
      const fallback = await axios.get(
        "https://upload.wikimedia.org/wikipedia/commons/3/3f/Placeholder_view_vector.svg",
        { responseType: "arraybuffer" }
      );
      base64Image = `data:image/svg+xml;base64,${Buffer.from(
        fallback.data
      ).toString("base64")}`;
    }

    const chatId = GROUP_ID.includes("@g.us") ? GROUP_ID : `${GROUP_ID}@g.us`;

    log.info("🕒 Waiting 3 seconds to ensure WhatsApp ready...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const ready = await client.isConnected();
    if (ready) {
      log.info(`📨 Sending startup message to ${chatId}`);
      await client.sendImageFromBase64(chatId.toString(), base64Image, "deal.jpg", caption);
      log.success("🚀 Startup test message sent to group!");
    } else {
      log.warn("⚠️ WhatsApp not fully ready — skipped startup message.");
    }
  } catch (err) {
    console.error("❌ FULL Init Error =>", err);
  }
})();
