/**
 * src/bot.js
 * LootAlert — stable WPPConnect WhatsApp bot (fixed send handling + robust image fetch + graceful errors)
 *
 * Key features:
 * - Robust WPPConnect + Puppeteer config for VPS (autoClose: false, protocolTimeout: 0)
 * - Dynamic / flexible POST /api/send for images/text/links
 * - Multi-group support (GROUP_IDS env or GROUP_ID)
 * - Base64 image conversion with headers & fallback
 * - Safe wrappers around send functions to avoid internal debug spam / unhandled rejections
 * - Process-level handlers for uncaught exceptions and unhandled promise rejections
 *
 * NOTE: Only required fixes applied. Rest of the file kept as before.
 */

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

// Environment & defaults
const PORT = process.env.PORT || 8080;
const AFFILIATE_ID = process.env.AFFILIATE_ID || "";
const RAW_GROUPS = process.env.GROUP_IDS || process.env.GROUP_ID || "";
// store as array of trimmed ids
const DEFAULT_GROUPS = RAW_GROUPS.split(",").filter(Boolean).map((g) => g.trim());

const CHROME_PATH = process.env.CHROME_PATH || process.env.CHROME_BIN || null;

// Globals
let clientGlobal = null;
let qrRef = { code: null, connected: false };

// Express init
const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "frontend")));

// Helper: normalize group id (ensure @g.us)
function normalizeGroupId(raw) {
  if (!raw) return null;
  const s = raw.trim();
  return s.includes("@g.us") ? s : `${s}@g.us`;
}

// Helper: safe wait
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Small helper to safely call async functions and return {ok,result,error}
async function safeCall(fn) {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error };
  }
}

// Process-level handlers so node doesn't exit unexpectedly and logs useful info
process.on("unhandledRejection", (reason, p) => {
  console.error("[UNHANDLED REJECTION] =>", reason);
  // don't exit; just log — this protects PM2 from silent crashes
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION] =>", err);
  // do not process.exit(1) here — allow PM2 to manage restarts.
});

// Route: dashboard page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// Route: QR/status
app.get("/api/qr", (req, res) => {
  if (qrRef.connected) return res.json({ status: "connected" });
  if (qrRef.code) return res.json({ status: "qr", qr: qrRef.code });
  return res.json({ status: "waiting" });
});

// Route: list groups (for dashboard / n8n)
app.get("/api/groups", async (req, res) => {
  try {
    if (!clientGlobal) return res.status(400).json({ error: "WhatsApp not connected" });
    const chatsSafe = await safeCall(() => clientGlobal.listChats({ onlyGroups: true }));
    if (!chatsSafe.ok) {
      log.error("Group list error:", chatsSafe.error);
      return res.status(500).json({ error: chatsSafe.error?.message || String(chatsSafe.error) });
    }
    const chats = chatsSafe.result || [];
    const formatted = chats.map((g) => ({
      name: g.name || "Unnamed Group",
      id: g.id?._serialized || g.id,
    }));
    return res.json({ groups: formatted });
  } catch (err) {
    log.error("Group list error:", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * POST /api/send
 * Accepts flexible payload from n8n/Postman:
 * {
 *   groupIds: ["120...@g.us", "otherid"],      // optional — falls back to DEFAULT_GROUPS
 *   message: "Custom headline",
 *   body: "Long body / description",           // optional
 *   image: "https://....jpg"                   // optional
 *   link: "https://amzn.to/..."                // optional
 *   urgency: "Hurry! 2 left"                   // optional
 *   delayBefore: number (ms)                   // optional - global pre-delay
 * }
 *
 * If no groups provided and DEFAULT_GROUPS empty -> 400
 */
app.post("/api/send", async (req, res) => {
  try {
    if (!clientGlobal) return res.status(400).json({ error: "WhatsApp not connected" });

    // ensure client is ready
    const isReadySafe = await safeCall(() => clientGlobal.isConnected && clientGlobal.isConnected());
    if (!isReadySafe.ok || isReadySafe.result === false) {
      return res.status(400).json({ error: "WhatsApp not ready yet" });
    }

    const payload = req.body || {};
    // use dynamic groups else default from env
    const groupsRaw =
      payload.groupIds && Array.isArray(payload.groupIds) && payload.groupIds.length
        ? payload.groupIds
        : DEFAULT_GROUPS;

    if (!groupsRaw || groupsRaw.length === 0) {
      return res.status(400).json({ error: "No group IDs provided (groupIds or GROUP_IDS env)" });
    }

    const groups = groupsRaw.map(normalizeGroupId).filter(Boolean);

    // Build message: allow simple or rich structure
    const title = payload.message || payload.title || sampleDeal.name || "🔥 Hot Deal";
    const body = payload.body || payload.description || payload.details || "";
    const link = payload.link || payload.url || sampleDeal.link || "";
    const urgency = payload.urgency || `⏳ Limited time offer — don't miss!`;
    const priceLine = payload.price ? `Price: ${payload.price}` : sampleDeal.price ? `Price: ₹${sampleDeal.price}` : "";

    // Compose caption / text (Hinglish-friendly, emotional, FOMO)
    const captionParts = [];
    captionParts.push(`🔥 *${title}*`);
    if (priceLine) captionParts.push(`💸 ${priceLine}`);
    if (body) captionParts.push(`${body}`);
    if (link) captionParts.push(`👉 Buy: ${link}`);
    captionParts.push(`${urgency}`);
    captionParts.push(`🔖 ${AFFILIATE_ID ? `#${AFFILIATE_ID}` : "LootAlert"}`);

    const finalCaption = captionParts.join("\n\n");

    // If image present, try fetch -> base64, else fallback to text only
    const imageUrl = payload.image || payload.img || sampleDeal.image || null;

    // We'll use axios for fetching images
    const axios = (await import("axios")).default;

    let base64Image = null;
    if (imageUrl) {
      try {
        const response = await axios.get(imageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            Accept: "image/*,*/*;q=0.8",
          },
        });
        if (response?.data) {
          const ct = (response.headers && response.headers["content-type"]) || "image/jpeg";
          const prefix = `data:${ct};base64,`;
          base64Image = prefix + Buffer.from(response.data, "binary").toString("base64");
        } else {
          base64Image = null;
        }
      } catch (err) {
        // Image fetch failed, log and fallback to text
        log.warn("Image fetch failed for", imageUrl, " — will send text only. Error:", err?.message || err);
        base64Image = null;
      }
    }

    // Optional global delay before sending
    if (payload.delayBefore && typeof payload.delayBefore === "number") {
      await wait(Math.max(0, payload.delayBefore));
    }

    // Iterate groups and send safely
    for (let i = 0; i < groups.length; i++) {
      const chatId = groups[i];
      try {
        log.info(`📨 Sending to ${chatId} (image: ${base64Image ? "yes" : "no"})`);

        // Wait small random time before each group send to avoid burst pattern
        const preDelay = 500 + Math.floor(Math.random() * 800);
        await wait(preDelay);

        if (base64Image) {
          // Use sendImageFromBase64 for reliability — wrap and inspect result
          const sendSafe = await safeCall(() =>
            clientGlobal.sendImageFromBase64(chatId, base64Image, "deal.jpg", finalCaption)
          );
          if (!sendSafe.ok) {
            // send failed — warn and continue
            log.error(`❌ sendImageFromBase64 failed for ${chatId}:`, sendSafe.error?.message || sendSafe.error);
          } else {
            const r = sendSafe.result;
            // wppconnect sometimes returns { erro: true, ... } or result object — handle both
            if (r && typeof r === "object" && r.erro === true) {
              log.warn(`⚠️ WPP returned erro for ${chatId}:`, r);
            } else {
              log.success(`✅ Sent to ${chatId}`);
            }
          }
        } else {
          // Plain text send
          const sendTextSafe = await safeCall(() => clientGlobal.sendText(chatId, finalCaption));
          if (!sendTextSafe.ok) {
            log.error(`❌ sendText failed for ${chatId}:`, sendTextSafe.error?.message || sendTextSafe.error);
          } else {
            const r = sendTextSafe.result;
            if (r && typeof r === "object" && r.erro === true) {
              log.warn(`⚠️ WPP returned erro for ${chatId}:`, r);
            } else {
              log.success(`✅ Sent to ${chatId}`);
            }
          }
        }
      } catch (err) {
        // This block is extra-safe — should not be hit because safeCall protects internal calls
        log.error(`❌ Unexpected send error for ${chatId}:`, err?.message || String(err));
      }

      // Post-send delay (longer) to reduce rate
      const postDelay = 1500 + Math.floor(Math.random() * 2500);
      await wait(postDelay);
    }

    return res.json({ ok: true, message: "Messages attempted (check logs for per-group status)" });
  } catch (err) {
    log.error("API send failed:", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

// Start Express
app.listen(PORT, "0.0.0.0", () => {
  log.info(`🌐 Dashboard available at http://localhost:${PORT}`);
});

/**
 * WPPConnect init
 * Key config values are aimed at VPS stability:
 * - autoClose: false -> prevent automatic session close
 * - protocolTimeout: 0 -> disable default timeouts
 * - restartOnCrash: true -> auto restart browser if it crashes
 * - puppeteerOptions.executablePath -> use system chrome if CHROME_PATH env
 */
(async () => {
  try {
    log.info("⏳ Initializing WPPConnect session...");

    const client = await wppconnect.create({
      session: "LootAlertStable",
      headless: "new",
      logQR: false,
      autoClose: false,
      protocolTimeout: 0,
      restartOnCrash: true,
      catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
        try {
          qrRef.code = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
            urlCode
          )}&size=300x300`;
        } catch (e) {
          qrRef.code = base64Qr || asciiQR || null;
        }
        log.info("📱 QR generated. Open /api/qr or dashboard to scan.");
      },
      onLoadingScreen: (percent, message) => {
        log.info(`Loading... ${percent}% - ${message}`);
      },
      onStateChange: (state) => {
        log.info(`WhatsApp state => ${state}`);
        if (state === "DISCONNECTED" || state === "UNPAIRED") {
          qrRef.connected = false;
        }
      },
      onConnected: () => {
        qrRef.connected = true;
        log.success("✅ WhatsApp connected (onConnected event)");
      },
      onLogout: () => {
        qrRef.connected = false;
        log.warn("🚪 Logged out. Please rescan QR.");
      },
      puppeteerOptions: {
        ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
          "--single-process",
          "--disable-software-rasterizer",
          "--window-size=1200,900",
        ],
        defaultViewport: null,
      },
    });

    clientGlobal = client;
    qrRef.connected = true;
    log.success("✅ WPPConnect client ready");

    // Optionally log groups to console
    try {
      const groupsSafe = await safeCall(() => client.listChats({ onlyGroups: true }));
      if (groupsSafe.ok) {
        const groups = groupsSafe.result || [];
        groups.forEach((g) => {
          const name = g.name || "Unnamed Group";
          const id = g.id?._serialized || g.id;
          console.log(`📢 ${name} — ${id}`);
        });
      } else {
        log.warn("Could not list groups (maybe not synced yet):", groupsSafe.error?.message || groupsSafe.error);
      }
    } catch (err) {
      log.warn("Could not list groups (maybe not synced yet):", err?.message || err);
    }

    // Send optional startup message to first configured group if any
    if (DEFAULT_GROUPS.length > 0) {
      try {
        const chatId = normalizeGroupId(DEFAULT_GROUPS[0]);
        if (chatId) {
          log.info("🕒 Waiting a few seconds before startup test send...");
          await wait(3000);

          const startCaption = createMessage(sampleDeal, AFFILIATE_ID);
          let sent = false;
          if (sampleDeal?.image) {
            try {
              const axios = (await import("axios")).default;
              const res = await axios.get(sampleDeal.image, { responseType: "arraybuffer", timeout: 12000 });
              const contentType = res.headers["content-type"] || "image/jpeg";
              const base64 = `data:${contentType};base64,${Buffer.from(res.data).toString("base64")}`;
              const sendSafe = await safeCall(() => client.sendImageFromBase64(chatId, base64, "startup.jpg", startCaption));
              if (!sendSafe.ok) {
                log.warn("Startup image send failed:", sendSafe.error?.message || sendSafe.error);
              } else {
                const r = sendSafe.result;
                if (r && r.erro === true) {
                  log.warn("Startup image send returned erro:", r);
                } else {
                  log.success("🚀 Startup test image sent!");
                  sent = true;
                }
              }
            } catch (e) {
              log.warn("Startup image send failed, will send text only:", e?.message || e);
            }
          }
          if (!sent) {
            const sendTextSafe = await safeCall(() => client.sendText(chatId, startCaption));
            if (!sendTextSafe.ok) {
              log.warn("Startup text send failed:", sendTextSafe.error?.message || sendTextSafe.error);
            } else {
              log.success("🚀 Startup test text sent!");
            }
          }
        }
      } catch (err) {
        log.warn("Startup message failed:", err?.message || err);
      }
    }
  } catch (err) {
    console.error("❌ FULL Init Error =>", err);
  }
})();

/**
 * Graceful shutdown helpers for PM2 or manual SIGINT
 */
async function gracefulShutdown() {
  try {
    log.info("🛑 Graceful shutdown initiated...");
    if (clientGlobal && clientGlobal.close) {
      try {
        await clientGlobal.close();
        log.info("🔒 WPPConnect client closed.");
      } catch (e) {
        log.warn("Error while closing WPPConnect client:", e?.message || e);
      }
    }
    // allow pm2 to stop the process
  } catch (e) {
    console.error("Error during graceful shutdown:", e);
  } finally {
    // do not forcibly exit — allow pm2 to handle process lifecycle
  }
}

process.on("SIGINT", async () => {
  await gracefulShutdown();
});

process.on("SIGTERM", async () => {
  await gracefulShutdown();
});
