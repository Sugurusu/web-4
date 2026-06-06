const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "records.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

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

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = path.normalize(path.join(ROOT, requestPath === "/" ? "index.html" : requestPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.url === "/api/records" && req.method === "GET") {
    sendJson(res, 200, { records: readRecords() });
    return;
  }

  if (req.url === "/api/records" && req.method === "PUT") {
    try {
      const body = await collectBody(req);
      const data = JSON.parse(body || "{}");
      if (!Array.isArray(data.records)) {
        sendJson(res, 400, { error: "records must be an array" });
        return;
      }
      writeRecords(data.records);
      sendJson(res, 200, { ok: true, records: data.records });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pull-up Battle server: http://localhost:${PORT}`);
  for (const address of localAddresses()) {
    console.log(`LAN URL: http://${address}:${PORT}`);
  }
});
