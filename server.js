const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "cloudwave-db.json");
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function initialDb() {
  return { users: [], ideas: [], chats: [], sessions: {} };
}

function readDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(initialDb(), null, 2));
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, saved) {
  const [salt, hash] = String(saved).split(":");
  const attempt = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
}

function userFromToken(req, db) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = db.sessions[token];
  return db.users.find((user) => user.id === userId) || null;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(root, safePath));
  if (!filePath.startsWith(root)) return json(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return json(res, 404, { error: "Not found" });
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const db = readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const user = userFromToken(req, db);
    return json(res, 200, {
      user: publicUser(user),
      ideas: db.ideas,
      chats: user ? db.chats.filter((chat) => chat.userIds.includes(user.id)) : [],
      stats: { users: db.users.length, ideas: db.ideas.length },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "Seller").trim();
    const password = String(body.password || "").trim();
    if (!name || !email || password.length < 6) return json(res, 400, { error: "Name, email, and a 6+ character password are required." });
    if (db.users.some((user) => user.email === email)) return json(res, 409, { error: "Email is already registered." });
    const user = { id: crypto.randomUUID(), name, email, role, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    const token = crypto.randomUUID();
    db.users.push(user);
    db.sessions[token] = user.id;
    writeDb(db);
    return json(res, 201, { token, user: publicUser(user), ideas: db.ideas, chats: [] });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) return json(res, 401, { error: "Invalid email or password." });
    const token = crypto.randomUUID();
    db.sessions[token] = user.id;
    writeDb(db);
    return json(res, 200, {
      token,
      user: publicUser(user),
      ideas: db.ideas,
      chats: db.chats.filter((chat) => chat.userIds.includes(user.id)),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/ideas") {
    const user = userFromToken(req, db);
    if (!user) return json(res, 401, { error: "Please log in first." });
    const body = await readBody(req);
    const idea = {
      ...body,
      id: crypto.randomUUID(),
      seller: user.name,
      ownerId: user.id,
      rating: "New",
      createdAt: new Date().toISOString(),
    };
    db.ideas.unshift(idea);
    writeDb(db);
    return json(res, 201, { idea, ideas: db.ideas });
  }

  return json(res, 404, { error: "API route not found." });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) return await handleApi(req, res);
    return serveFile(req, res);
  } catch (error) {
    return json(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Cloudwave running on http://${host}:${port}`);
});
