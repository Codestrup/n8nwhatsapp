import express from "express";
import { log } from "./utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApi(client, groupId, qrRef) {
  const app = express();
  app.use(express.json());

  // serve frontend
  app.use(express.static(path.join(__dirname, "frontend")));

  // frontend: fetch qr or connection status
  app.get("/api/qr", (req, res) => {
    if (qrRef.connected) {
      res.json({ status: "connected" });
    } else if (qrRef.code) {
      res.json({ status: "qr", qr: qrRef.code });
    } else {
      res.json({ status: "waiting" });
    }
  });

  // test send endpoint
  app.post("/api/send", async (req, res) => {
    try {
      const { image, caption } = req.body;
      await client.sendImage(groupId, image, "deal.jpg", caption);
      log.success("✅ Sent test message to group");
      res.json({ ok: true, message: "✅ Test message sent!" });
    } catch (err) {
      log.error(err);
      res.status(500).json({ error: err.toString() });
    }
  });

  app.get("/", (req, res) =>
    res.sendFile(path.join(__dirname, "frontend", "index.html"))
  );

  return app;
}