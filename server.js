const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "cloudwave-db.json");
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";
const adminCode = process.env.ADMIN_CODE || "CLOUDWAVE-ADMIN";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const oneHourMs = 60 * 60 * 1000;
const exposeDevTokens = process.env.NODE_ENV !== "production";
const resendApiKey = process.env.RESEND_API_KEY || "";
const fromEmail = process.env.FROM_EMAIL || "Cloudwave <onboarding@resend.dev>";
const appUrl = process.env.APP_URL || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function initialDb() {
  return { users: [], ideas: [], chats: [], sessions: {}, emailVerificationTokens: {}, passwordResetTokens: {} };
}

function readDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(initialDb(), null, 2));
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  db.users ||= [];
  db.ideas ||= [];
  db.chats ||= [];
  db.sessions ||= {};
  db.emailVerificationTokens ||= {};
  db.passwordResetTokens ||= {};
  for (const [token, session] of Object.entries(db.sessions)) {
    if (typeof session === "string") {
      db.sessions[token] = { userId: session, expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() };
    }
  }
  return db;
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
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
}

function tokenFromReq(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function userFromToken(req, db) {
  const token = tokenFromReq(req);
  const session = db.sessions[token];
  if (!session) return null;
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!expiresAt || expiresAt <= Date.now()) {
    delete db.sessions[token];
    writeDb(db);
    return null;
  }
  return db.users.find((user) => user.id === session.userId) || null;
}

function createSession(db, user) {
  const token = crypto.randomUUID();
  db.sessions[token] = { userId: user.id, expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() };
  return token;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: true, createdAt: user.createdAt };
}

function isAdmin(user) {
  return user?.role === "Admin";
}

function requireVerified(user, res) {
  if (!user) {
    json(res, 401, { error: "Please log in first." });
    return false;
  }
  return true;
}

function appOrigin(req) {
  if (appUrl) return appUrl.replace(/\/$/, "");
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${hostHeader}`;
}

async function sendEmail({ to, subject, html, text }) {
  if (!resendApiKey) {
    console.log(`Email not sent to ${to}: RESEND_API_KEY is not configured.`);
    return false;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromEmail, to, subject, html, text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email provider rejected the message: ${detail || response.status}`);
  }
  return true;
}

async function issuePasswordReset(db, user, req) {
  const token = crypto.randomBytes(24).toString("hex");
  db.passwordResetTokens[token] = {
    userId: user.id,
    expiresAt: new Date(Date.now() + oneHourMs).toISOString(),
  };
  const origin = appOrigin(req);
  const link = `${origin}/?reset=${encodeURIComponent(token)}`;
  const sent = await sendEmail({
    to: user.email,
    subject: "Reset your Cloudwave password",
    text: `Reset your Cloudwave password by opening this link: ${link}\n\nThis token expires in 1 hour. If you did not request it, you can ignore this email.`,
    html: `<p>Reset your Cloudwave password.</p><p><a href="${link}">Reset password</a></p><p>This token expires in 1 hour. If you did not request it, you can ignore this email.</p>`,
  });
  console.log(`Password reset for ${user.email}: ${link}`);
  return { token, link, sent };
}

function tokenRecordIsValid(record) {
  return record && new Date(record.expiresAt).getTime() > Date.now();
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function validateIdeaPackage(idea) {
  const fullText = [
    idea.summary,
    idea.target,
    idea.model,
    idea.whyNow,
    idea.roadmap,
    idea.competitorGaps,
    idea.marketingStrategy,
    idea.pricingStrategy,
    idea.assets,
  ]
    .filter(Boolean)
    .join(" ");
  const checks = [
    wordCount(fullText) >= 300,
    wordCount(idea.target) >= 4,
    wordCount(idea.competitorGaps) >= 20,
    wordCount(idea.roadmap) >= 25,
    wordCount(idea.marketingStrategy) >= 20,
    wordCount(idea.pricingStrategy) >= 15,
    Boolean(idea.ownershipDeclared),
  ];
  return checks.filter(Boolean).length >= checks.length - 1;
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
      adminIdeas: isAdmin(user) ? db.ideas : [],
      stats: { users: db.users.length, ideas: db.ideas.length },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "Seller").trim();
    const password = String(body.password || "").trim();
    const submittedAdminCode = String(body.adminCode || "").trim();
    if (!name || !email || password.length < 6) return json(res, 400, { error: "Name, email, and a 6+ character password are required." });
    if (role === "Admin" && submittedAdminCode !== adminCode) return json(res, 403, { error: "Invalid admin code." });
    if (db.users.some((user) => user.email === email)) return json(res, 409, { error: "Email is already registered." });
    const user = { id: crypto.randomUUID(), name, email, role, passwordHash: hashPassword(password), emailVerified: true, createdAt: new Date().toISOString() };
    const token = createSession(db, user);
    db.users.push(user);
    writeDb(db);
    return json(res, 201, {
      token,
      user: publicUser(user),
      ideas: db.ideas,
      chats: [],
      message: "Account created. You can use Cloudwave now.",
    });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) return json(res, 401, { error: "Invalid email or password." });
    const token = createSession(db, user);
    writeDb(db);
    return json(res, 200, {
      token,
      user: publicUser(user),
      ideas: db.ideas,
      chats: db.chats.filter((chat) => chat.userIds.includes(user.id)),
      message: "Logged in.",
    });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = tokenFromReq(req);
    if (token) delete db.sessions[token];
    writeDb(db);
    return json(res, 200, { message: "Logged out." });
  }

  if (req.method === "POST" && url.pathname === "/api/forgot-password") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = db.users.find((item) => item.email === email);
    const reset = user ? await issuePasswordReset(db, user, req) : null;
    writeDb(db);
    return json(res, 200, {
      message: "If that email exists, a password reset token has been sent.",
      ...(exposeDevTokens && reset ? { resetToken: reset.token, resetLink: reset.link } : {}),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/reset-password") {
    const body = await readBody(req);
    const token = String(body.token || "").trim();
    const password = String(body.password || "").trim();
    if (password.length < 6) return json(res, 400, { error: "New password must be at least 6 characters." });
    const record = db.passwordResetTokens[token];
    if (!tokenRecordIsValid(record)) return json(res, 400, { error: "Password reset token is invalid or expired." });
    const user = db.users.find((item) => item.id === record.userId);
    if (!user) return json(res, 404, { error: "User for this reset token was not found." });
    user.passwordHash = hashPassword(password);
    user.passwordChangedAt = new Date().toISOString();
    delete db.passwordResetTokens[token];
    for (const [sessionToken, session] of Object.entries(db.sessions)) {
      if (session.userId === user.id) delete db.sessions[sessionToken];
    }
    writeDb(db);
    return json(res, 200, { message: "Password reset. Please log in with the new password." });
  }

  if (req.method === "POST" && url.pathname === "/api/profile/change-password") {
    const user = userFromToken(req, db);
    if (!requireVerified(user, res)) return;
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "").trim();
    const newPassword = String(body.newPassword || "").trim();
    if (!verifyPassword(currentPassword, user.passwordHash)) return json(res, 401, { error: "Current password is incorrect." });
    if (newPassword.length < 6) return json(res, 400, { error: "New password must be at least 6 characters." });
    if (currentPassword === newPassword) return json(res, 400, { error: "New password must be different from the current password." });
    user.passwordHash = hashPassword(newPassword);
    user.passwordChangedAt = new Date().toISOString();
    const activeToken = tokenFromReq(req);
    for (const [sessionToken, session] of Object.entries(db.sessions)) {
      if (session.userId === user.id && sessionToken !== activeToken) delete db.sessions[sessionToken];
    }
    writeDb(db);
    return json(res, 200, { message: "Password changed." });
  }

  if (req.method === "POST" && url.pathname === "/api/ideas") {
    const user = userFromToken(req, db);
    if (!requireVerified(user, res)) return;
    const body = await readBody(req);
    if (!validateIdeaPackage(body)) return json(res, 400, { error: "Listing package is too weak. Add 300+ words, competitor gaps, roadmap, marketing/pricing strategy, and ownership declaration." });
    const idea = {
      ...body,
      id: crypto.randomUUID(),
      seller: user.name,
      ownerId: user.id,
      rating: "New",
      status: "pending_review",
      createdAt: new Date().toISOString(),
    };
    db.ideas.unshift(idea);
    writeDb(db);
    return json(res, 201, { idea, ideas: db.ideas });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/ideas") {
    const user = userFromToken(req, db);
    if (!isAdmin(user)) return json(res, 403, { error: "Admin access required." });
    return json(res, 200, { ideas: db.ideas });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/admin/ideas/")) {
    const user = userFromToken(req, db);
    if (!isAdmin(user)) return json(res, 403, { error: "Admin access required." });
    const parts = url.pathname.split("/");
    const ideaId = parts[4];
    const action = parts[5];
    const idea = db.ideas.find((item) => item.id === ideaId);
    if (!idea) return json(res, 404, { error: "Listing not found." });
    if (action === "approve") {
      idea.status = "live";
      idea.reviewedAt = new Date().toISOString();
      idea.reviewedBy = user.id;
    } else if (action === "reject") {
      idea.status = "rejected";
      idea.reviewedAt = new Date().toISOString();
      idea.reviewedBy = user.id;
    } else {
      return json(res, 400, { error: "Unknown admin action." });
    }
    writeDb(db);
    return json(res, 200, { idea, ideas: db.ideas });
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
