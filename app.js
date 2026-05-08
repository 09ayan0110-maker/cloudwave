const starterIdeas = [];

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      return false;
    }
    return true;
  },
};

if (location.protocol === "file:" && store.get("cloudwaveBlankVersion", 0) !== 1) {
  localStorage.removeItem("cloudwaveUser");
  localStorage.removeItem("cloudwaveIdeas");
  localStorage.removeItem("cloudwaveSaved");
  localStorage.removeItem("cloudwaveChats");
  store.set("cloudwaveBlankVersion", 1);
}

let currentUser = store.get("cloudwaveUser", null);
let ideas = store.get("cloudwaveIdeas", starterIdeas);
let savedIds = new Set(store.get("cloudwaveSaved", []));
let conversations = store.get("cloudwaveChats", []);
let adminIdeas = [];
let adminUsers = [];
let activeChatId = conversations[0]?.id || "";
let activeFilter = "All";
let sellStep = 1;
let authToken = store.get("cloudwaveToken", "");
let loginMode = "customer";
const apiAvailable = location.protocol === "http:" || location.protocol === "https:";

const screens = document.querySelectorAll(".screen");
const navButtons = document.querySelectorAll("[data-screen]");
const bottomButtons = document.querySelectorAll(".bottom-nav button");
const ideaList = document.querySelector("#idea-list");
const trendingList = document.querySelector("#trending-list");
const searchInput = document.querySelector("#search-input");
const filterRow = document.querySelector("#filter-row");
const detailContent = document.querySelector("#detail-content");
const inboxList = document.querySelector("#inbox-list");
const chatHeader = document.querySelector("#chat-header");
const chatThread = document.querySelector("#chat-thread");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const adminList = document.querySelector("#admin-list");

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveIdeas() {
  if (!apiAvailable) store.set("cloudwaveIdeas", ideas);
}

function saveSavedIds() {
  store.set("cloudwaveSaved", [...savedIds]);
  updateProfileStats();
}

function saveConversations() {
  if (!apiAvailable) store.set("cloudwaveChats", conversations);
}

function saveCurrentUser() {
  store.set("cloudwaveUser", currentUser);
}

function saveAuthToken(token) {
  authToken = token || "";
  store.set("cloudwaveToken", authToken);
}

async function apiRequest(path, options = {}) {
  if (!apiAvailable) throw new Error("Open through the server to use shared registration.");
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || data.message || `Request failed with status ${response.status}.`;
      const error = new Error(message);
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Could not reach the server. Check that it is running, then try again.");
    throw error;
  }
}

function applyServerData(data) {
  if ("user" in data) currentUser = data.user;
  saveCurrentUser();
  if (Array.isArray(data.ideas)) {
    ideas = data.ideas;
    saveIdeas();
  }
  if (Array.isArray(data.chats)) {
    conversations = data.chats;
    saveConversations();
    activeChatId = conversations[0]?.id || "";
  }
  if (Array.isArray(data.adminIdeas)) {
    adminIdeas = data.adminIdeas;
  }
  if (Array.isArray(data.adminUsers)) {
    adminUsers = data.adminUsers;
  }
  renderTrending();
  renderIdeas();
  renderConversations();
  renderActiveChat();
  renderAdminPanel();
  renderHomeStats(data.stats);
  updateProfileStats();
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function setLoginMode(mode) {
  loginMode = mode === "admin" ? "admin" : "customer";
  document.querySelector("#customer-login-mode")?.classList.toggle("active", loginMode === "customer");
  document.querySelector("#admin-login-mode")?.classList.toggle("active", loginMode === "admin");
  const role = document.querySelector("#signup-role");
  const name = document.querySelector("#signup-name");
  const adminCode = document.querySelector("#signup-admin-code");
  if (role && loginMode === "admin") role.value = "Admin";
  if (name) name.placeholder = loginMode === "admin" ? "Admin name" : "Your name";
  if (adminCode) adminCode.parentElement.style.display = loginMode === "admin" || role?.value === "Admin" ? "" : "none";
}

function setScreen(name) {
  if (!currentUser && ["sell", "messages", "profile"].includes(name)) {
    showToast("Create an account to use this section");
    name = "auth";
  }
  if (name === "admin" && currentUser?.role !== "Admin") {
    showToast("Admin access required");
    name = "home";
  }
  screens.forEach((screen) => screen.classList.toggle("active", screen.id === `${name}-screen`));
  bottomButtons.forEach((button) => button.classList.toggle("active", button.dataset.screen === name));
  if (name === "admin") loadAdminData();
}

function tagClass(value) {
  if (value === "AI" || value === "License") return "";
  if (value === "SaaS" || value === "HealthTech") return "teal";
  return "amber";
}

function priceNumber(price) {
  const clean = String(price).replace(/[₹,\s]/g, "").toLowerCase();
  if (clean.includes("l")) return parseFloat(clean) * 100000;
  if (clean.includes("k")) return parseFloat(clean) * 1000;
  return Number.parseFloat(clean) || 0;
}

function formatRupees(value) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function assessIdea(idea) {
  const text = [idea.title, idea.summary, idea.target, idea.model, idea.whyNow, idea.roadmap].join(" ").toLowerCase();
  let score = 58;

  if (["AI", "SaaS", "Fintech", "HealthTech"].includes(idea.category)) score += 8;
  if (String(idea.model).length > 16) score += 7;
  if (String(idea.target).length > 22) score += 6;
  if (String(idea.roadmap).length > 45) score += 7;
  if (text.includes("subscription") || text.includes("saas") || text.includes("commission")) score += 6;
  if (text.includes("pilot") || text.includes("customer") || text.includes("stores") || text.includes("schools")) score += 4;
  if (idea.competition === "Low") score += 6;
  if (idea.competition === "High") score -= 6;
  if (priceNumber(idea.price) > 100000) score -= 3;
  if (priceNumber(idea.price) > 0 && priceNumber(idea.price) <= 50000) score += 3;
  score = Math.max(35, Math.min(96, Math.round(score)));

  const grade = score >= 86 ? "Strong buy" : score >= 74 ? "Promising" : score >= 62 ? "Needs diligence" : "High risk";
  const risk =
    idea.competition === "High"
      ? "Competitive market. Buyer should validate distribution and differentiation before paying a premium."
      : score >= 74
        ? "Main risk is execution quality. The listing should include proof, research, or early customer signals."
        : "The idea needs clearer buyer pain, target customer, and go-to-market evidence.";
  const recommendation =
    score >= 86
      ? "Package this with research docs, MVP screens, and a short validation memo to justify the price."
      : score >= 74
        ? "Add competitor gaps, customer interview notes, and launch cost assumptions to make the listing easier to trust."
        : "Rewrite the listing around one specific customer, one urgent problem, and one simple first revenue path.";
  const summary =
    score >= 86
      ? "High execution potential with a clear market, realistic pricing, and monetization path."
      : score >= 74
        ? "Good opportunity, but buyers will want stronger validation before moving fast."
        : "Interesting concept, but it currently reads more like a raw idea than a purchase-ready opportunity.";

  return { score, grade, risk, recommendation, summary };
}

function estimateIdeaValue(idea) {
  const assessment = assessIdea(idea);
  const baseByCategory = {
    AI: 28000,
    SaaS: 32000,
    Fintech: 42000,
    HealthTech: 30000,
    Education: 22000,
    Marketplace: 26000,
  };
  let value = baseByCategory[idea.category] || 20000;
  const text = [idea.summary, idea.target, idea.model, idea.whyNow, idea.roadmap].join(" ").toLowerCase();

  value += (assessment.score - 60) * 950;
  if (text.includes("research") || text.includes("interview")) value += 8000;
  if (text.includes("wireframe") || text.includes("mockup") || text.includes("prototype")) value += 12000;
  if (text.includes("pilot") || text.includes("customer")) value += 15000;
  if (text.includes("subscription") || text.includes("saas")) value += 9000;
  if (idea.saleType === "Full sale") value += 10000;
  if (idea.saleType === "Partnership") value -= 5000;

  const low = Math.max(5000, value * 0.78);
  const high = Math.max(low + 5000, value * 1.24);
  const asking = priceNumber(idea.price);
  const verdict =
    asking && asking > high
      ? "Your asking price is above the current estimate. Add stronger proof or lower the price."
      : asking && asking < low
        ? "You may be underpricing this. Add a clean pitch pack and ask closer to the midpoint."
        : "Your asking price sits inside a realistic seller range.";

  return {
    low,
    high,
    midpoint: (low + high) / 2,
    verdict,
    drivers: [
      `${idea.category} category demand`,
      `${assessment.score}/100 listing strength`,
      text.includes("prototype") || text.includes("wireframe") ? "Includes build assets" : "Could be worth more with prototype assets",
      text.includes("customer") || text.includes("pilot") ? "Has validation language" : "Needs customer validation proof",
    ],
  };
}

function packageText(idea) {
  return [
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
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function qualityGate(idea) {
  const text = packageText(idea);
  const words = wordCount(text);
  const checks = [
    { label: "300+ word business package", pass: words >= 300 },
    { label: "Real customer pain point", pass: wordCount(idea.whyNow) >= 25 || wordCount(idea.summary) >= 25 },
    { label: "Target customer defined", pass: wordCount(idea.target) >= 4 },
    { label: "Revenue plan included", pass: wordCount(idea.model) >= 1 },
    { label: "Competitor gaps explained", pass: wordCount(idea.competitorGaps) >= 20 },
    { label: "MVP roadmap included", pass: wordCount(idea.roadmap) >= 25 },
    { label: "Marketing strategy included", pass: wordCount(idea.marketingStrategy) >= 20 },
    { label: "Pricing strategy included", pass: wordCount(idea.pricingStrategy) >= 15 },
    { label: "Ownership declared", pass: Boolean(idea.ownershipDeclared) },
  ];
  const passed = checks.filter((check) => check.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  return {
    score,
    words,
    checks,
    approved: score >= 85 && words >= 300,
    missing: checks.filter((check) => !check.pass).map((check) => check.label),
  };
}

function ideaCard(idea, compact = false) {
  const saved = savedIds.has(String(idea.id));
  const assessment = assessIdea(idea);
  const quality = qualityGate(idea);
  return `
    <article class="idea-card ${compact ? "compact" : ""}">
      <div class="card-top">
        <div>
          <h3>${escapeHTML(idea.title)}</h3>
          <p>${escapeHTML(idea.summary)}</p>
        </div>
        <button class="save-button ${saved ? "saved" : ""}" data-save="${idea.id}" aria-label="Save ${escapeHTML(idea.title)}">${saved ? "♥" : "♡"}</button>
      </div>
      <div class="tag-row">
        <span class="tag ${tagClass(idea.category)}">${escapeHTML(idea.category)}</span>
        <span class="tag ${tagClass(idea.saleType)}">${escapeHTML(idea.saleType)}</span>
        <span class="tag ${quality.approved ? "teal" : "amber"}">${escapeHTML(idea.status === "live" ? "Live" : "Pending review")}</span>
        <span class="tag amber">${escapeHTML(idea.competition)} competition</span>
      </div>
      <div class="score-row">
        <span><strong>${escapeHTML(idea.price)}</strong><small>Asking price</small></span>
        <span><strong>${escapeHTML(idea.revenue)}/10</strong><small>Revenue score</small></span>
        <span><strong>${escapeHTML(idea.rating)}</strong><small>Seller</small></span>
      </div>
      <div class="ai-score">
        <span>Listing quality</span>
        <strong>${quality.score}/100</strong>
        <small>${quality.approved ? "Review ready" : "Needs work"}</small>
      </div>
      <div class="card-actions">
        <button data-detail="${idea.id}">View Deal</button>
        <button data-negotiate="${idea.id}">Negotiate</button>
      </div>
    </article>
  `;
}

function visibleIdeas() {
  const search = searchInput?.value.trim().toLowerCase() || "";
  return ideas.filter((idea) => {
    const filterMatch =
      activeFilter === "All" ||
      idea.category === activeFilter ||
      idea.saleType === activeFilter ||
      (activeFilter === "Budget" && idea.price !== "₹1.2L");
    const searchMatch = [idea.title, idea.summary, idea.category, idea.saleType]
      .join(" ")
      .toLowerCase()
      .includes(search);
    return filterMatch && searchMatch;
  });
}

function renderIdeas() {
  const visible = visibleIdeas();
  ideaList.innerHTML = visible.map((idea) => ideaCard(idea, true)).join("");
  if (!visible.length) {
    ideaList.innerHTML = `<div class="empty-state"><h3>No listings yet</h3><p>Cloudwave starts blank. Real seller listings will appear here after they are submitted.</p><button data-screen="sell">List an idea</button></div>`;
  }
}

function renderTrending() {
  trendingList.innerHTML = ideas.slice(0, 3).map((idea) => ideaCard(idea)).join("");
  if (!ideas.length) {
    trendingList.innerHTML = `<div class="empty-state"><h3>No trending ideas yet</h3><p>Trending will appear after real listings get views and saves.</p></div>`;
  }
}

function renderDetail(id) {
  const idea = ideas.find((item) => String(item.id) === String(id));
  if (!idea) return;
  const saved = savedIds.has(String(idea.id));
  const assessment = assessIdea(idea);
  const storedAnalysis = idea.analysis || {};
  const fallbackValue = estimateIdeaValue(idea);
  const valueEstimate = storedAnalysis.valueEstimate || fallbackValue;
  const storedScore = storedAnalysis.strengthScore || qualityGate(idea).score;
  detailContent.innerHTML = `
    <section class="detail-hero">
      <span class="tag ${tagClass(idea.category)}">${escapeHTML(idea.category)}</span>
      <h2>${escapeHTML(idea.title)}</h2>
      <p>${escapeHTML(idea.summary)}</p>
      <div class="score-row">
        <span><strong>${escapeHTML(idea.seller)}</strong><small>Seller</small></span>
        <span><strong>${escapeHTML(idea.revenue)}/10</strong><small>AI forecast</small></span>
      </div>
    </section>
    <div class="price-grid">
      <button data-buy="${idea.id}">Full<br>${escapeHTML(idea.price)}</button>
      <button data-buy="${idea.id}">License<br>${escapeHTML(idea.license)}</button>
      <button data-negotiate="${idea.id}">Partner<br>${escapeHTML(idea.partner)}</button>
    </div>
    <div class="card-actions">
      <button ${idea.status === "live" ? `data-buy="${idea.id}"` : `type="button" data-pending="${idea.id}"`}>${idea.status === "live" ? "Buy Now" : "Pending Review"}</button>
      <button data-message="${idea.id}">Message Seller</button>
      <button data-save="${idea.id}">${saved ? "Saved" : "Save"}</button>
    </div>
    <section class="ai-assessment-panel">
      <div>
        <span class="story-badge">Trust & quality</span>
        <h3>${idea.status === "live" ? "Live listing" : "Pending moderator review"}</h3>
        <p>${idea.status === "live" ? "This opportunity passed the listing quality gate." : "This package is submitted but should be reviewed before buyers can purchase."}</p>
      </div>
      <div class="assessment-score">
        <strong>${storedScore}</strong>
        <span>/100</span>
      </div>
      <div class="assessment-grid">
        <div><b>Estimated value</b><p>${formatRupees(valueEstimate.low)}-${formatRupees(valueEstimate.high)}. ${escapeHTML(storedAnalysis.pricingSignal || fallbackValue.verdict)}</p></div>
        <div><b>AI-generated risk</b><p>${escapeHTML(storedAnalysis.aiGeneratedLabel || "Needs review")} (${storedAnalysis.aiGeneratedRisk ?? "n/a"})</p></div>
        <div><b>Risk</b><p>${escapeHTML(assessment.risk)}</p></div>
        <div><b>Recommendation</b><p>${escapeHTML(assessment.recommendation)}</p></div>
        <div><b>Buyer warning</b><p>Cloudwave lists business opportunities, not guaranteed results. Execution risk remains with the buyer.</p></div>
        <div><b>Protection</b><p>${idea.ndaRequired ? "NDA required before private details are revealed." : "Seller has not required NDA for this package."} Escrow and transfer agreement are recommended for every purchase.</p></div>
      </div>
    </section>
    <section class="detail-section">
      <h3>Problem Solved</h3>
      <p>${escapeHTML(idea.summary)} The listing includes research notes, revenue assumptions, and a first-version build plan.</p>
    </section>
    <section class="detail-section">
      <h3>Target Market</h3>
      <p>${escapeHTML(idea.target)}</p>
    </section>
    <section class="detail-section">
      <h3>Revenue Model</h3>
      <p>${escapeHTML(idea.model)}</p>
    </section>
    <section class="detail-section">
      <h3>Why Now?</h3>
      <p>${escapeHTML(idea.whyNow)}</p>
    </section>
    <section class="detail-section">
      <h3>Competitor Gaps</h3>
      <p>${escapeHTML(idea.competitorGaps || "Not provided yet.")}</p>
    </section>
    <section class="detail-section">
      <h3>Go-To-Market</h3>
      <p>${escapeHTML(idea.marketingStrategy || "Not provided yet.")}</p>
    </section>
    <section class="detail-section">
      <h3>Pricing Strategy</h3>
      <p>${escapeHTML(idea.pricingStrategy || "Not provided yet.")}</p>
    </section>
    <section class="detail-section">
      <h3>MVP Roadmap</h3>
      <p>${escapeHTML(idea.roadmap)}</p>
      <div class="difficulty" aria-label="Medium build difficulty"><span></span></div>
    </section>
  `;
  setScreen("detail");
}

function updateSellStep(nextStep) {
  sellStep = Math.min(4, Math.max(1, nextStep));
  document.querySelectorAll(".form-step").forEach((step) => {
    step.classList.toggle("active", Number(step.dataset.step) === sellStep);
  });
  document.querySelector("#step-count").textContent = sellStep;
  document.querySelector("#progress-fill").style.width = `${sellStep * 25}%`;
  document.querySelector("#prev-step").style.visibility = sellStep === 1 ? "hidden" : "visible";
  document.querySelector("#next-step").textContent = sellStep === 4 ? "Submit for Review" : "Next";
}

async function createIdeaFromForm() {
  const form = document.querySelector("#sell-form");
  const firstStep = form.querySelector('[data-step="1"]');
  const secondStep = form.querySelector('[data-step="2"]');
  const thirdStep = form.querySelector('[data-step="3"]');
  const fourthStep = form.querySelector('[data-step="4"]');
  const title = firstStep.querySelector("input").value.trim() || "Untitled Startup Idea";
  const category = firstStep.querySelector("select").value;
  const summary = firstStep.querySelector("textarea").value.trim() || "A new marketplace opportunity.";
  const problem = secondStep.querySelectorAll("textarea")[0].value.trim();
  const solution = secondStep.querySelectorAll("textarea")[1].value.trim();
  const competitorGaps = secondStep.querySelectorAll("textarea")[2].value.trim();
  const whyNow = secondStep.querySelectorAll("textarea")[3].value.trim();
  const model = thirdStep.querySelector("select").value;
  const target = thirdStep.querySelector("input").value.trim() || "Early adopters and startup teams";
  const price = thirdStep.querySelectorAll("input")[1].value.trim() || "₹20,000";
  const marketingStrategy = thirdStep.querySelectorAll("textarea")[0].value.trim();
  const pricingStrategy = thirdStep.querySelectorAll("textarea")[1].value.trim();
  const saleType = fourthStep.querySelector("select").value;
  const assets = fourthStep.querySelector("textarea").value.trim();
  const ownershipDeclared = document.querySelector("#ownership-check").checked;
  const ndaRequired = document.querySelector("#nda-check").checked;

  const idea = {
    id: Date.now(),
    title,
    summary,
    category,
    price,
    license: "Custom",
    partner: "Open",
    revenue: "8.0",
    competition: "Medium",
    seller: currentUser?.name || "New seller",
    rating: "New",
    saleType,
    target,
    model,
    whyNow: whyNow || problem || "The market is ready for faster, simpler startup execution.",
    competitorGaps,
    marketingStrategy,
    pricingStrategy,
    assets,
    ownershipDeclared,
    ndaRequired,
    status: "pending_review",
    submittedAt: new Date().toISOString(),
    roadmap: [solution, assets].filter(Boolean).join(" ") || "Validate demand, build MVP, launch pilot, close first customers.",
  };

  const quality = qualityGate(idea);
  if (!quality.approved) {
    const output = document.querySelector("#ai-output");
    if (output) {
      output.innerHTML = `
        <strong>Not ready for review (${quality.score}/100)</strong>
        <p>${quality.words}/300 words. Missing: ${escapeHTML(quality.missing.slice(0, 4).join(", "))}${quality.missing.length > 4 ? "..." : ""}</p>
      `;
    }
    showToast("Listing needs more detail before review");
    return;
  }

  if (apiAvailable && authToken) {
    try {
      const data = await apiRequest("/api/ideas", { method: "POST", body: JSON.stringify(idea) });
      ideas = data.ideas;
    } catch (error) {
      showToast(error.message);
      return;
    }
  } else {
    ideas = [idea, ...ideas];
    saveIdeas();
  }
  renderTrending();
  renderIdeas();
  renderHomeStats();
  updateProfileStats();
  showToast("Submitted for moderator review");
  setScreen("explore");
  updateSellStep(1);
}

function initialsFor(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function findOrCreateConversation(idea) {
  const id = `chat-${String(idea.seller).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${idea.id}`;
  let conversation = conversations.find((chat) => chat.id === id);
  if (!conversation) {
    conversation = {
      id,
      seller: idea.seller,
      initials: initialsFor(idea.seller),
      ideaTitle: idea.title,
      offer: idea.price,
      status: "offer",
      messages: [
        { from: "seller", text: `Thanks for checking out ${idea.title}. I can share more details after NDA.` },
      ],
    };
    conversations = [conversation, ...conversations];
    saveConversations();
  }
  return conversation;
}

function dealSteps(status) {
  const steps = [
    ["accepted", "Offer accepted"],
    ["escrow", "Buyer pays escrow"],
    ["nda", "NDA signed"],
    ["transfer", "Idea assets transferred"],
    ["review", "Buyer review window"],
    ["released", "Funds released"],
  ];
  const activeIndex = Math.max(0, steps.findIndex(([key]) => key === status));
  return steps
    .map(([key, label], index) => {
      const state = index < activeIndex ? "done" : index === activeIndex ? "current" : "";
      return `<li class="${state}" data-step="${key}"><span>${index + 1}</span>${label}</li>`;
    })
    .join("");
}

function dealPanel(chat) {
  if (!chat.status || chat.status === "offer") {
    return `
      <div class="offer-box">
        <span>Offer value</span>
        <strong>${escapeHTML(chat.offer)}</strong>
        <button type="button" data-accept-offer="${escapeHTML(chat.id)}">Accept</button>
      </div>
    `;
  }

  return `
    <section class="deal-panel">
      <div class="deal-panel-top">
        <div>
          <span class="story-badge">Deal room</span>
          <h3>${chat.status === "released" ? "Deal completed" : "Offer accepted"}</h3>
          <p>${chat.status === "released" ? "Ownership transfer is complete and funds have been released." : "Cloudwave is holding the deal through escrow and transfer checks."}</p>
        </div>
        <strong>${escapeHTML(chat.offer)}</strong>
      </div>
      <ol class="deal-steps">${dealSteps(chat.status)}</ol>
      <div class="deal-actions">
        <button type="button" data-deal-next="${escapeHTML(chat.id)}">${chat.status === "released" ? "Completed" : "Move to Next Step"}</button>
        <button type="button" data-download-agreement="${escapeHTML(chat.id)}">Agreement</button>
      </div>
    </section>
  `;
}

function renderConversations() {
  if (!inboxList) return;
  if (!conversations.length) {
    inboxList.innerHTML = `<div class="empty-state small"><h3>No messages</h3><p>Chats will appear after a buyer contacts a seller about a real listing.</p></div>`;
    return;
  }
  inboxList.innerHTML = conversations
    .map((chat, index) => {
      const lastMessage = chat.messages.at(-1)?.text || "No messages yet";
      return `
        <button class="chat-preview ${chat.id === activeChatId ? "active" : ""}" data-chat="${escapeHTML(chat.id)}">
          <span class="avatar ${index % 2 ? "green" : ""}">${escapeHTML(chat.initials)}</span>
          <span><strong>${escapeHTML(chat.seller)}</strong><small>${escapeHTML(lastMessage)}</small></span>
          <b>${index === 0 ? "now" : "1h"}</b>
        </button>
      `;
    })
    .join("");
}

function renderActiveChat() {
  if (!chatThread || !chatHeader) return;
  const chat = conversations.find((item) => item.id === activeChatId) || conversations[0];
  if (!chat) {
    chatHeader.innerHTML = "<strong>No conversation selected</strong>";
    chatThread.innerHTML = `<div class="empty-state small"><h3>No active chat</h3><p>Messages start when a real buyer opens a negotiation.</p></div>`;
    return;
  }
  activeChatId = chat.id;
  chatHeader.innerHTML = `
    <div>
      <strong>${escapeHTML(chat.seller)}</strong>
      <small>${escapeHTML(chat.ideaTitle)}</small>
    </div>
    <span class="step-pill">NDA ready</span>
  `;
  chatThread.innerHTML = `
    ${chat.messages.map((message) => `<div class="message ${message.from}">${escapeHTML(message.text)}</div>`).join("")}
    ${dealPanel(chat)}
  `;
  chatThread.scrollTop = chatThread.scrollHeight;
  renderConversations();
}

function sellerReplyFor(chat, text) {
  const lower = text.toLowerCase();
  if (chat.status && chat.status !== "offer") {
    if (lower.includes("escrow") || lower.includes("pay")) return "Once escrow is funded, I will upload the full asset pack and ownership draft here.";
    if (lower.includes("nda")) return "Yes, NDA first. After it is signed I can reveal the full research notes and roadmap.";
    if (lower.includes("asset") || lower.includes("doc") || lower.includes("file")) return "The asset pack includes the concept note, customer assumptions, competitor gaps, and MVP roadmap.";
    return "Sounds good. I will keep the deal room updated as each transfer step is completed.";
  }
  if (lower.includes("price") || lower.includes("lower") || lower.includes("discount") || lower.includes("final")) {
    return `I can be flexible, but ${chat.offer} includes the core idea pack, research notes, and handover support.`;
  }
  if (lower.includes("nda")) return "Happy to do NDA before sharing the full details. The public listing only shows the overview.";
  if (lower.includes("proof") || lower.includes("validate") || lower.includes("customer")) return "I have early research notes and a competitor gap map. I can include those in the transfer.";
  if (lower.includes("buy") || lower.includes("deal") || lower.includes("accept")) return "If you are ready, accept the offer and Cloudwave can move it into escrow.";
  if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) return `Hey, thanks for reaching out. Are you interested in buying full rights or licensing ${chat.ideaTitle}?`;
  return "Thanks. I can share more once we agree on price and NDA. What terms are you thinking?";
}

function queueSellerReply(chatId, buyerText) {
  const chat = conversations.find((item) => item.id === chatId);
  if (!chat) return;
  chat.messages.push({ from: "seller", text: "Typing..." });
  renderActiveChat();
  window.setTimeout(() => {
    const latestChat = conversations.find((item) => item.id === chatId);
    if (!latestChat) return;
    const typingIndex = latestChat.messages.findIndex((message) => message.from === "seller" && message.text === "Typing...");
    if (typingIndex !== -1) latestChat.messages.splice(typingIndex, 1);
    latestChat.messages.push({ from: "seller", text: sellerReplyFor(latestChat, buyerText) });
    saveConversations();
    renderActiveChat();
  }, 850);
}

function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const chat = conversations.find((item) => item.id === activeChatId);
  if (!chat) return;
  chat.messages.push({ from: "buyer", text: trimmed });
  saveConversations();
  renderActiveChat();
  messageInput.value = "";
  queueSellerReply(chat.id, trimmed);
}

function acceptOffer(chatId) {
  const chat = conversations.find((item) => item.id === chatId);
  if (!chat) return;
  chat.status = "accepted";
  chat.messages.push({ from: "seller", text: `Offer accepted for ${chat.offer}. Next step: buyer funds escrow so the transfer can begin.` });
  chat.messages.push({ from: "buyer", text: "Great. I will fund escrow and wait for the NDA and asset package." });
  saveConversations();
  renderActiveChat();
  showToast("Offer accepted. Deal room opened.");
}

function moveDealForward(chatId) {
  const chat = conversations.find((item) => item.id === chatId);
  if (!chat || chat.status === "released") return;
  const flow = ["accepted", "escrow", "nda", "transfer", "review", "released"];
  const nextStatus = flow[Math.min(flow.indexOf(chat.status) + 1, flow.length - 1)];
  chat.status = nextStatus;
  const statusMessages = {
    escrow: "Escrow funded. Payment is held securely until transfer checks are complete.",
    nda: "NDA signed. Seller can now share full documents, wireframes, and research.",
    transfer: "Asset package transferred: concept note, roadmap, research docs, and ownership draft.",
    review: "Buyer review window started. Buyer can inspect the assets before release.",
    released: "Deal complete. Funds released to seller and ownership marked transferred.",
  };
  chat.messages.push({ from: nextStatus === "released" ? "seller" : "buyer", text: statusMessages[nextStatus] });
  saveConversations();
  renderActiveChat();
  showToast(statusMessages[nextStatus]);
}

function currentDraftIdea() {
  const form = document.querySelector("#sell-form");
  const firstStep = form.querySelector('[data-step="1"]');
  const secondStep = form.querySelector('[data-step="2"]');
  const thirdStep = form.querySelector('[data-step="3"]');
  const fourthStep = form.querySelector('[data-step="4"]');
  return {
    title: firstStep.querySelector("input").value.trim() || "Draft idea",
    summary: firstStep.querySelector("textarea").value.trim() || "A new startup opportunity.",
    category: firstStep.querySelector("select").value,
    price: thirdStep.querySelectorAll("input")[1].value.trim() || "₹20,000",
    license: "Custom",
    partner: "Open",
    revenue: "8.0",
    competition: "Medium",
    seller: currentUser?.name || "New seller",
    rating: "New",
    saleType: fourthStep.querySelector("select").value,
    target: thirdStep.querySelector("input").value.trim() || "Early adopters",
    model: thirdStep.querySelector("select").value,
    whyNow: secondStep.querySelectorAll("textarea")[3].value.trim() || secondStep.querySelectorAll("textarea")[0].value.trim(),
    competitorGaps: secondStep.querySelectorAll("textarea")[2].value.trim(),
    marketingStrategy: thirdStep.querySelectorAll("textarea")[0].value.trim(),
    pricingStrategy: thirdStep.querySelectorAll("textarea")[1].value.trim(),
    assets: fourthStep.querySelector("textarea").value.trim(),
    ownershipDeclared: document.querySelector("#ownership-check").checked,
    ndaRequired: document.querySelector("#nda-check").checked,
    roadmap: [secondStep.querySelectorAll("textarea")[1].value.trim(), fourthStep.querySelector("textarea").value.trim()].filter(Boolean).join(" "),
  };
}

function runDraftAI(tool) {
  const draft = currentDraftIdea();
  const assessment = assessIdea(draft);
  const valuation = estimateIdeaValue(draft);
  const quality = qualityGate(draft);
  const output = document.querySelector("#ai-output");
  const messages = {
    improve: `Quality score ${quality.score}/100 with ${quality.words}/300 words. ${quality.approved ? "This is ready for moderator review." : `Missing: ${quality.missing.slice(0, 4).join(", ")}.`}`,
    price: `Estimated idea value: ${formatRupees(valuation.low)}-${formatRupees(valuation.high)}. Suggested asking price: ${formatRupees(valuation.midpoint)}. ${valuation.verdict}`,
    market: `${assessment.grade}. ${assessment.summary} ${assessment.risk}`,
  };
  if (output) {
    output.innerHTML = `
      <strong>${tool === "price" ? "Idea Valuation" : tool === "market" ? "Market AI" : "Listing AI"}</strong>
      <p>${escapeHTML(messages[tool])}</p>
      ${
        tool === "price"
          ? `<div class="valuation-box">
              <span>Estimated worth</span>
              <b>${formatRupees(valuation.low)}-${formatRupees(valuation.high)}</b>
              <small>${valuation.drivers.map(escapeHTML).join(" • ")}</small>
            </div>`
          : ""
      }
    `;
  }
  showToast("AI assessment updated");
}

function toggleSave(id) {
  const key = String(id);
  if (savedIds.has(key)) {
    savedIds.delete(key);
    showToast("Removed from saved ideas");
  } else {
    savedIds.add(key);
    showToast("Saved idea");
  }
  saveSavedIds();
  renderTrending();
  renderIdeas();
  if (detailContent.innerHTML.trim()) renderDetail(id);
}

function startNegotiation(id) {
  if (!currentUser) {
    showToast("Create an account to message sellers.");
    setScreen("auth");
    return;
  }
  const idea = ideas.find((item) => String(item.id) === String(id));
  if (idea) {
    const chat = findOrCreateConversation(idea);
    activeChatId = chat.id;
    if (!chat.messages.some((message) => message.text.includes("Can we discuss terms?"))) {
      chat.messages.push({ from: "buyer", text: `I am interested in ${idea.title}. Can we discuss terms?` });
      saveConversations();
      queueSellerReply(chat.id, `I am interested in ${idea.title}. Can we discuss terms?`);
    }
  }
  renderActiveChat();
  showToast("Message thread opened");
  setScreen("messages");
}

function updateProfileStats() {
  const stats = document.querySelectorAll(".profile-stats strong");
  if (stats[0]) stats[0].textContent = savedIds.size;
  if (stats[1]) stats[1].textContent = ideas.filter((idea) => idea.seller === currentUser?.name).length;
  const profileName = document.querySelector("#profile-name");
  const profileBio = document.querySelector("#profile-bio");
  const profileInitials = document.querySelector("#profile-initials");
  const profileRole = document.querySelector("#profile-role");
  if (profileName) profileName.textContent = currentUser?.name || "Guest";
  if (profileBio) {
    profileBio.textContent = currentUser
      ? `${currentUser.role} account using live user-created data.`
      : "Create an account to sell, save, and message.";
  }
  if (profileInitials) profileInitials.textContent = currentUser ? initialsFor(currentUser.name) : "G";
  if (profileRole) profileRole.textContent = currentUser?.role || "Guest";
}

function renderHomeStats(serverStats = null) {
  const totalValue = ideas.reduce((sum, idea) => sum + priceNumber(idea.price), 0);
  const statValues = document.querySelectorAll(".metrics-strip strong");
  if (statValues[0]) statValues[0].textContent = formatRupees(totalValue);
  if (statValues[1]) statValues[1].textContent = serverStats?.ideas ?? ideas.length;
  if (statValues[2]) statValues[2].textContent = serverStats?.users ?? (currentUser ? "1" : "0");
}

function renderAdminPanel() {
  const bottomNav = document.querySelector(".bottom-nav");
  bottomNav?.classList.toggle("admin-mode", currentUser?.role === "Admin");
  if (!adminList) return;
  if (currentUser?.role !== "Admin") {
    adminList.innerHTML = `<div class="empty-state"><h3>Admin only</h3><p>Register or log in with an admin account to moderate listings.</p></div>`;
    return;
  }
  const pending = adminIdeas.filter((idea) => idea.status === "pending_review");
  const live = adminIdeas.filter((idea) => idea.status === "live");
  const rejected = adminIdeas.filter((idea) => idea.status === "rejected");
  document.querySelector("#admin-pending-count").textContent = pending.length;
  document.querySelector("#admin-live-count").textContent = live.length;
  document.querySelector("#admin-rejected-count").textContent = rejected.length;
  const ordered = [...pending, ...live, ...rejected];
  const ideaReview = ordered.length
    ? ordered
    .map((idea) => {
      const quality = qualityGate(idea);
      const analysis = idea.analysis || {};
      const value = analysis.valueEstimate;
      return `
        <article class="admin-card">
          <div class="card-top">
            <div>
              <h3>${escapeHTML(idea.title)}</h3>
              <p>${escapeHTML(idea.summary)}</p>
            </div>
            <span class="tag ${idea.status === "live" ? "teal" : idea.status === "rejected" ? "amber" : ""}">${escapeHTML(idea.status || "pending_review")}</span>
          </div>
          <div class="score-row">
            <span><strong>${analysis.qualityScore || quality.score}/100</strong><small>Quality</small></span>
            <span><strong>${analysis.aiGeneratedRisk ?? "n/a"}</strong><small>AI risk</small></span>
            <span><strong>${value ? formatRupees(value.midpoint) : "n/a"}</strong><small>Value</small></span>
            <span><strong>${quality.words}</strong><small>Words</small></span>
            <span><strong>${escapeHTML(idea.seller)}</strong><small>Seller</small></span>
          </div>
          <p>${escapeHTML(analysis.aiGeneratedLabel || "No server analysis yet.")}</p>
          <p>${escapeHTML(quality.missing.length ? `Missing: ${quality.missing.join(", ")}` : "All quality requirements passed.")}</p>
          <div class="admin-actions">
            <button data-admin-action="approve" data-admin-id="${idea.id}">Approve</button>
            <button data-admin-action="reject" data-admin-id="${idea.id}">Reject</button>
          </div>
        </article>
      `;
    })
    .join("")
    : `<div class="empty-state"><h3>No listings to review</h3><p>Submitted ideas will appear here before going live.</p></div>`;
  const userReview = adminUsers.length
    ? adminUsers
        .map((user) => `
          <article class="admin-card">
            <div class="card-top">
              <div>
                <h3>${escapeHTML(user.name)}</h3>
                <p>${escapeHTML(user.email)}</p>
              </div>
              <span class="tag ${user.role === "Admin" ? "teal" : ""}">${escapeHTML(user.role)}</span>
            </div>
            <p>Joined ${escapeHTML(new Date(user.createdAt || Date.now()).toLocaleDateString())}</p>
          </article>
        `)
        .join("")
    : `<div class="empty-state"><h3>No users yet</h3><p>New accounts will appear here.</p></div>`;
  adminList.innerHTML = `<h3 class="admin-section-title">Idea review</h3>${ideaReview}<h3 class="admin-section-title">Users</h3>${userReview}`;
}

async function loadAdminData() {
  if (currentUser?.role !== "Admin" || !apiAvailable) return;
  try {
    const data = await apiRequest("/api/admin/ideas");
    adminIdeas = data.ideas || [];
    const users = await apiRequest("/api/admin/users");
    adminUsers = users.users || [];
    renderAdminPanel();
  } catch (error) {
    showToast(error.message);
  }
}

async function moderateIdea(id, action) {
  if (!apiAvailable) {
    const idea = ideas.find((item) => String(item.id) === String(id));
    if (idea) idea.status = action === "approve" ? "live" : "rejected";
    adminIdeas = ideas;
    renderAdminPanel();
    renderIdeas();
    showToast(`Listing ${action === "approve" ? "approved" : "rejected"}`);
    return;
  }
  try {
    const data = await apiRequest(`/api/admin/ideas/${id}/${action}`, { method: "POST" });
    ideas = data.ideas;
    adminIdeas = data.ideas;
    renderAdminPanel();
    renderIdeas();
    renderTrending();
    showToast(`Listing ${action === "approve" ? "approved" : "rejected"}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function createAccount() {
  const name = document.querySelector("#signup-name").value.trim();
  const email = document.querySelector("#signup-email").value.trim();
  const password = document.querySelector("#signup-password").value.trim();
  const role = document.querySelector("#signup-role").value;
  const adminCode = document.querySelector("#signup-admin-code").value.trim();
  if (!name || !email || password.length < 6) {
    showToast("Enter name, email, and 6+ character password");
    return;
  }
  if (apiAvailable) {
    try {
      const data = await apiRequest("/api/register", { method: "POST", body: JSON.stringify({ name, email, role, password, adminCode }) });
      saveAuthToken(data.token);
      applyServerData(data);
      await loadAdminData();
      showToast(data.message || "Account created");
      setScreen("home");
    } catch (error) {
      showToast(error.message);
    }
  } else {
    currentUser = { name, email, role, createdAt: new Date().toISOString() };
    saveCurrentUser();
    renderHomeStats();
    updateProfileStats();
    adminIdeas = ideas;
    renderAdminPanel();
    showToast("Local account created");
    setScreen("home");
  }
}

async function loginAccount() {
  const email = document.querySelector("#signup-email").value.trim();
  const password = document.querySelector("#signup-password").value.trim();
  if (!email || !password) {
    showToast("Enter email and password");
    return;
  }
  if (!apiAvailable) {
    showToast("Login needs the server version");
    return;
  }
  try {
    const path = loginMode === "admin" ? "/api/admin/login" : "/api/login";
    const data = await apiRequest(path, { method: "POST", body: JSON.stringify({ email, password }) });
    saveAuthToken(data.token);
    applyServerData(data);
    await loadAdminData();
    showToast(data.message || "Logged in");
    setScreen("home");
  } catch (error) {
    showToast(error.message);
  }
}

async function forgotPassword() {
  const email = document.querySelector("#signup-email")?.value.trim();
  if (!email) {
    showToast("Enter your email first.");
    return;
  }
  try {
    const data = await apiRequest("/api/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
    const tokenInput = document.querySelector("#reset-token");
    if (tokenInput && data.resetToken) tokenInput.value = data.resetToken;
    showToast(data.message || "Password reset token sent");
  } catch (error) {
    showToast(error.message);
  }
}

async function resetPassword() {
  const token = document.querySelector("#reset-token")?.value.trim();
  const password = document.querySelector("#reset-password")?.value.trim();
  if (!token || password.length < 6) {
    showToast("Enter the reset token and a new 6+ character password.");
    return;
  }
  try {
    const data = await apiRequest("/api/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
    saveAuthToken("");
    currentUser = null;
    saveCurrentUser();
    showToast(data.message || "Password reset");
    setScreen("auth");
  } catch (error) {
    showToast(error.message);
  }
}

async function changePassword() {
  const currentPassword = document.querySelector("#current-password")?.value.trim();
  const newPassword = document.querySelector("#new-password")?.value.trim();
  if (!currentPassword || newPassword.length < 6) {
    showToast("Enter your current password and a new 6+ character password.");
    return;
  }
  try {
    const data = await apiRequest("/api/profile/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
    document.querySelector("#current-password").value = "";
    document.querySelector("#new-password").value = "";
    showToast(data.message || "Password changed");
  } catch (error) {
    showToast(error.message);
  }
}

async function logoutAccount() {
  try {
    if (apiAvailable && authToken) await apiRequest("/api/logout", { method: "POST" });
  } catch (error) {
    showToast(error.message);
  }
  saveAuthToken("");
  currentUser = null;
  conversations = [];
  adminIdeas = [];
  adminUsers = [];
  saveCurrentUser();
  renderConversations();
  renderActiveChat();
  renderAdminPanel();
  updateProfileStats();
  showToast("Logged out");
  setScreen("auth");
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const screen = button.dataset.screen;
    if (screen) setScreen(screen);
  });
});

document.addEventListener("click", (event) => {
  const detailButton = event.target.closest("[data-detail]");
  if (detailButton) renderDetail(detailButton.dataset.detail);

  const saveButton = event.target.closest("[data-save]");
  if (saveButton) toggleSave(saveButton.dataset.save);

  const negotiateButton = event.target.closest("[data-negotiate]");
  if (negotiateButton) startNegotiation(negotiateButton.dataset.negotiate);

  const messageButton = event.target.closest("[data-message]");
  if (messageButton) startNegotiation(messageButton.dataset.message);

  const buyButton = event.target.closest("[data-buy]");
  if (buyButton) showToast("Checkout request created");

  const pendingButton = event.target.closest("[data-pending]");
  if (pendingButton) showToast("Listing must pass moderator review before purchase");

  const categoryButton = event.target.closest(".category-grid [data-filter]");
  if (categoryButton) {
    activeFilter = categoryButton.dataset.filter;
    filterRow.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.filter === activeFilter));
    renderIdeas();
    setScreen("explore");
  }

  const acceptButton = event.target.closest("[data-accept-offer]");
  if (acceptButton) acceptOffer(acceptButton.dataset.acceptOffer);

  const nextDealButton = event.target.closest("[data-deal-next]");
  if (nextDealButton) moveDealForward(nextDealButton.dataset.dealNext);

  const agreementButton = event.target.closest("[data-download-agreement]");
  if (agreementButton) showToast("Agreement preview generated");

  const aiButton = event.target.closest("[data-ai-tool]");
  if (aiButton) runDraftAI(aiButton.dataset.aiTool);

  const chatButton = event.target.closest("[data-chat]");
  if (chatButton) {
    activeChatId = chatButton.dataset.chat;
    renderActiveChat();
  }

  const adminAction = event.target.closest("[data-admin-action]");
  if (adminAction) {
    moderateIdea(adminAction.dataset.adminId, adminAction.dataset.adminAction);
  }

});

filterRow.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  activeFilter = button.dataset.filter;
  filterRow.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  renderIdeas();
});

searchInput.addEventListener("input", renderIdeas);

document.querySelector("#next-step").addEventListener("click", () => {
  if (sellStep === 4) {
    createIdeaFromForm();
    return;
  }
  updateSellStep(sellStep + 1);
});

document.querySelector("#prev-step").addEventListener("click", () => updateSellStep(sellStep - 1));

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

document.querySelector("#create-account")?.addEventListener("click", createAccount);
document.querySelector("#login-account")?.addEventListener("click", loginAccount);
document.querySelector("#customer-login-mode")?.addEventListener("click", () => setLoginMode("customer"));
document.querySelector("#admin-login-mode")?.addEventListener("click", () => setLoginMode("admin"));
document.querySelector("#signup-role")?.addEventListener("change", () => setLoginMode(document.querySelector("#signup-role").value === "Admin" ? "admin" : "customer"));
document.querySelector("#forgot-password")?.addEventListener("click", forgotPassword);
document.querySelector("#reset-password-button")?.addEventListener("click", resetPassword);
document.querySelector("#change-password-button")?.addEventListener("click", changePassword);
document.querySelector("#logout-account")?.addEventListener("click", logoutAccount);

document.querySelector("#continue-guest")?.addEventListener("click", () => {
  showToast("Browsing as guest");
  setScreen("home");
});

async function initApp() {
  setLoginMode("customer");
  const params = new URLSearchParams(location.search);
  const resetParam = params.get("reset");
  if (resetParam) {
    const input = document.querySelector("#reset-token");
    if (input) input.value = resetParam;
  }
  if (apiAvailable) {
    try {
      applyServerData(await apiRequest("/api/bootstrap"));
      await loadAdminData();
    } catch {
      renderTrending();
      renderIdeas();
      renderConversations();
      renderActiveChat();
      renderHomeStats();
      renderAdminPanel();
      updateProfileStats();
    }
  } else {
    adminIdeas = ideas;
    renderTrending();
    renderIdeas();
    renderConversations();
    renderActiveChat();
    renderHomeStats();
    renderAdminPanel();
    updateProfileStats();
  }
  updateSellStep(1);
  setScreen(currentUser ? "home" : "auth");
}

initApp();
