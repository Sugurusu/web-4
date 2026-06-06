const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "records.json");

const app = express();

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Prevent caching
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// JSON parser
app.use(express.json());

function readRecords() {
  try {
    const text = fs.readFileSync(DATA_FILE, "utf8");
    const records = JSON.parse(text);
    return Array.isArray(records) ? records : null;
  } catch {
    return null;
  }
}

function writeRecords(records) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
}

// API routes
app.get("/api/records", (req, res) => {
  res.json({ records: readRecords() });
});

app.put("/api/records", (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data.records)) {
      return res.status(400).json({ error: "records must be an array" });
    }
    writeRecords(data.records);
    res.json({ ok: true, records: data.records });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Static files
app.use(express.static(ROOT));

// Fallback to index.html for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Pull-up Battle server: http://localhost:${PORT}`);
  for (const address of Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address)) {
    console.log(`LAN URL: http://${address}:${PORT}`);
  }
});
