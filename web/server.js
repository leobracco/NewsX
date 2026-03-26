require("dotenv").config();
const express     = require("express");
const session     = require("express-session");
const axios       = require("axios");
const path        = require("path");
const fs          = require("fs");
const {
  getNewsList,
  getNewsBySlug,
  getCategories,
} = require("../src/publishers/couchPublisher");

const app      = express();
const PORT     = process.env.WEB_PORT     || 3000;
const BASE_URL = process.env.WEB_BASE_URL || "http://localhost:3000";
const PAGE_SIZE = 9;

// ─── AUTH CONFIG ─────────────────────────────────────────────────────
const ADMIN_USER           = process.env.ADMIN_USER           || "admin";
const ADMIN_PASS           = process.env.ADMIN_PASS           || "agroparallel2026";
const SESSION_SECRET       = process.env.SESSION_SECRET       || "agro-parallel-secret-key-change-me";
const RECAPTCHA_SITE_KEY   = process.env.RECAPTCHA_SITE_KEY   || "";
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || "";

// ─── MIDDLEWARE ───────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// ─── STATIC FILES ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

const carouselDir = process.env.CAROUSEL_OUTPUT_DIR
  ? path.resolve(process.env.CAROUSEL_OUTPUT_DIR)
  : path.join(__dirname, "../data/carousels");
fs.mkdirSync(carouselDir, { recursive: true });
app.use("/carruseles", express.static(carouselDir));

// ─── VIEWS ───────────────────────────────────────────────────────────
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// ─── HELPERS ─────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit", month: "long", year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function excerpt(text, len = 160) {
  if (!text) return "";
  return text.length > len ? text.substring(0, len).trimEnd() + "…" : text;
}

function carouselImageUrl(itemId, format, filename) {
  return `${BASE_URL}/carruseles/${itemId}/${format}/${filename}`;
}

function baseVars(extra = {}) {
  return {
    title: undefined, metaDesc: undefined,
    ogTitle: undefined, ogDesc: undefined,
    search: null, BASE_URL,
    formatDate, excerpt,
    ...extra,
  };
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect("/admin/login");
}

function requireAdminAPI(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ ok: false, error: "No autorizado" });
}

// ─── CouchDB helper ─────────────────────────────────────────────────
const COUCH_URL  = process.env.COUCHDB_URL     || "http://localhost:5984";
const COUCH_USER = process.env.COUCHDB_USER     || "admin";
const COUCH_PASS = process.env.COUCHDB_PASSWORD || "password";
const DB_NAME    = process.env.COUCHDB_DB       || "agro_parallel_news";

function couchRequest(method, docPath, data) {
  const url = `${COUCH_URL}/${DB_NAME}/${docPath}`;
  return axios({
    method, url, data,
    auth: { username: COUCH_USER, password: COUCH_PASS },
    headers: { "Content-Type": "application/json" },
  });
}


// ═════════════════════════════════════════════════════════════════════
//  ADMIN: LOGIN / LOGOUT
// ═════════════════════════════════════════════════════════════════════

app.get("/admin/login", (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect("/admin");
  const error = req.query.error || null;
  res.render("admin_login", { error, RECAPTCHA_SITE_KEY });
});

app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;
  const recaptchaResponse = req.body["g-recaptcha-response"];

  // Verificar reCAPTCHA si está configurado
  if (RECAPTCHA_SECRET_KEY) {
    if (!recaptchaResponse) {
      return res.redirect("/admin/login?error=captcha");
    }
    try {
      const captchaVerify = await axios.post(
        "https://www.google.com/recaptcha/api/siteverify",
        null,
        { params: { secret: RECAPTCHA_SECRET_KEY, response: recaptchaResponse } }
      );
      if (!captchaVerify.data.success) {
        return res.redirect("/admin/login?error=captcha");
      }
    } catch (e) {
      console.error("reCAPTCHA verify error:", e.message);
      return res.redirect("/admin/login?error=captcha");
    }
  }

  // Verificar credenciales
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    req.session.adminUser = username;
    return res.redirect("/admin");
  }

  res.redirect("/admin/login?error=credentials");
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});


// ═════════════════════════════════════════════════════════════════════
//  ADMIN: VIEWS (protegidas con requireAdmin)
// ═════════════════════════════════════════════════════════════════════

app.get("/admin", requireAdmin, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const category = req.query.categoria || null;
    const search   = req.query.q?.toLowerCase() || null;
    const skip     = (page - 1) * 20;

    const [{ rows, totalRows }, categories] = await Promise.all([
      getNewsList({ limit: 20, skip, category }),
      getCategories(),
    ]);

    const filtered = search
      ? rows.filter(n =>
          n.web?.title?.toLowerCase().includes(search) ||
          n.web?.tags?.some(t => t.toLowerCase().includes(search))
        )
      : rows;

    const allItems = await getNewsList({ limit: 1000 });
    const stats = {
      total:      allItems.totalRows || filtered.length,
      published:  allItems.rows?.filter(n => n.publishedTo?.length > 0).length || 0,
      pending:    allItems.rows?.filter(n => !n.publishedTo?.length).length || allItems.totalRows,
      categories: categories.length,
      lastUpdate: filtered[0] ? formatDate(filtered[0].publishedAt) : null,
    };

    res.render("admin_dashboard", {
      news: filtered, categories, currentCat: category, search,
      page, totalPages: Math.ceil(totalRows / 20), totalRows,
      stats, formatDate, excerpt, BASE_URL,
      adminUser: req.session.adminUser,
    });
  } catch (e) {
    console.error("Admin error:", e);
    res.status(500).send("Error cargando admin: " + e.message);
  }
});

app.get("/admin/edit/:slug", requireAdmin, async (req, res) => {
  try {
    const news = await getNewsBySlug(req.params.slug);
    if (!news) return res.status(404).send("Publicación no encontrada");

    const carouselUrls = [];
    if (news.botItemId) {
      for (const fmt of ["vertical", "square", "horizontal", "story"]) {
        const dir = path.join(carouselDir, news.botItemId, fmt);
        try {
          const files = fs.readdirSync(dir).filter(f => f.endsWith(".png")).sort();
          if (files.length && carouselUrls.length === 0) {
            files.forEach(f => {
              carouselUrls.push(`${BASE_URL}/carruseles/${news.botItemId}/${fmt}/${f}`);
            });
          }
        } catch {}
      }
    }

    res.render("admin_edit", { news, carouselUrls, formatDate, excerpt, BASE_URL });
  } catch (e) {
    console.error("Admin edit error:", e);
    res.status(500).send("Error: " + e.message);
  }
});

app.get("/admin/pipeline", requireAdmin, (req, res) => {
  res.render("admin_pipeline");
});

app.get("/admin/carruseles", requireAdmin, async (req, res) => {
  try {
    const { rows } = await getNewsList({ limit: 20 });
    const newsWithSlides = rows.map(item => {
      const slides = {};
      ["square", "vertical", "horizontal", "story"].forEach(fmt => {
        const dir = path.join(carouselDir, item.botItemId || "", fmt);
        try {
          slides[fmt] = fs.readdirSync(dir).filter(f => f.endsWith(".png")).sort();
        } catch { slides[fmt] = []; }
      });
      return { ...item, slides };
    });
    res.render("admin_carousels", { news: newsWithSlides, BASE_URL, formatDate, excerpt });
  } catch (e) {
    console.error("Error en /admin/carruseles:", e);
    res.status(500).send("Error");
  }
});


// ═════════════════════════════════════════════════════════════════════
//  ADMIN: API (protegidas con requireAdminAPI)
// ═════════════════════════════════════════════════════════════════════

app.get("/api/admin/news/:id", requireAdminAPI, async (req, res) => {
  try {
    const docRes = await couchRequest("GET", req.params.id);
    res.json({ ok: true, news: docRes.data });
  } catch (e) {
    res.status(404).json({ ok: false, error: "No encontrada" });
  }
});

app.put("/api/admin/news/:id", requireAdminAPI, async (req, res) => {
  try {
    const docRes = await couchRequest("GET", req.params.id);
    const doc = docRes.data;
    const updates = req.body;

    if (updates.web)       doc.web       = { ...doc.web,       ...updates.web };
    if (updates.instagram) doc.instagram = { ...doc.instagram, ...updates.instagram };
    if (updates.facebook)  doc.facebook  = { ...doc.facebook,  ...updates.facebook };
    if (updates.carousel)  doc.carousel  = { ...doc.carousel,  ...updates.carousel };
    doc.updatedAt = new Date().toISOString();

    const saveRes = await couchRequest("PUT", req.params.id, doc);
    res.json({ ok: true, rev: saveRes.data.rev });
  } catch (e) {
    console.error("API update error:", e.response?.data || e.message);
    res.status(500).json({ ok: false, error: e.response?.data?.reason || e.message });
  }
});

app.delete("/api/admin/news/:id", requireAdminAPI, async (req, res) => {
  try {
    const docRes = await couchRequest("GET", req.params.id);
    const rev = docRes.data._rev;
    await couchRequest("DELETE", `${req.params.id}?rev=${rev}`);

    const botItemId = docRes.data.botItemId;
    if (botItemId) {
      try { fs.rmSync(path.join(carouselDir, botItemId), { recursive: true, force: true }); } catch {}
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("API delete error:", e.response?.data || e.message);
    res.status(500).json({ ok: false, error: e.response?.data?.reason || e.message });
  }
});

app.post("/api/admin/publish/:id", requireAdminAPI, async (req, res) => {
  const { platform } = req.body;
  try {
    const docRes = await couchRequest("GET", req.params.id);
    const doc = docRes.data;

    if (platform === "instagram") {
      const { publishCarouselToInstagram } = require("../src/publishers/instagramPublisher");
      const vertDir = path.join(carouselDir, doc.botItemId || "", "vertical");
      let imagePaths = [];
      try {
        imagePaths = fs.readdirSync(vertDir).filter(f => f.endsWith(".png")).sort().map(f => path.join(vertDir, f));
      } catch {}
      if (imagePaths.length < 2) return res.json({ ok: false, error: "Se necesitan al menos 2 slides" });

      const result = await publishCarouselToInstagram(
        { id: doc.botItemId, generated: doc, original: { url: doc.source?.url } }, imagePaths, "vertical"
      );
      if (result) {
        if (!doc.publishedTo) doc.publishedTo = [];
        if (!doc.publishedTo.includes("instagram")) doc.publishedTo.push("instagram");
        doc.instagramResult = result;
        await couchRequest("PUT", req.params.id, doc);
        return res.json({ ok: true, result });
      }
      return res.json({ ok: false, error: "No se pudo publicar" });
    }

    if (platform === "facebook") {
      const { publishCarouselToFacebook } = require("../src/publishers/facebookPublisher");
      const sqDir = path.join(carouselDir, doc.botItemId || "", "square");
      let imagePaths = [];
      try {
        imagePaths = fs.readdirSync(sqDir).filter(f => f.endsWith(".png")).sort().map(f => path.join(sqDir, f));
      } catch {}

      const result = await publishCarouselToFacebook(
        { generated: doc, original: { url: doc.source?.url } }, imagePaths
      );
      if (result) {
        if (!doc.publishedTo) doc.publishedTo = [];
        if (!doc.publishedTo.includes("facebook")) doc.publishedTo.push("facebook");
        doc.facebookResult = result;
        await couchRequest("PUT", req.params.id, doc);
        return res.json({ ok: true, result });
      }
      return res.json({ ok: false, error: "No se pudo publicar" });
    }

    res.json({ ok: false, error: `Plataforma "${platform}" no soportada aún` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/admin/regenerate-carousel/:id", requireAdminAPI, async (req, res) => {
  try {
    const docRes = await couchRequest("GET", req.params.id);
    const doc = docRes.data;
    if (!doc.carousel || !doc.botItemId) return res.json({ ok: false, error: "Sin datos de carrusel" });

    const { generateAllFormats } = require("../src/carouselGenerator");
    const newsItem = {
      id: doc.botItemId,
      generated: { carousel: doc.carousel },
      original: { source: doc.source, url: doc.source?.url },
    };
    const results = await generateAllFormats(newsItem, carouselDir);
    doc.carouselImages = results;
    doc.carouselRegenAt = new Date().toISOString();
    await couchRequest("PUT", req.params.id, doc);
    res.json({ ok: true, formats: Object.keys(results) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/admin/pipeline", requireAdminAPI, async (req, res) => {
  try {
    const { runPipeline } = require("../src/scheduler");
    const result = await runPipeline();
    res.json({ ok: true, processed: result?.length || 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ═════════════════════════════════════════════════════════════════════
//  RUTAS PÚBLICAS (blog)
// ═════════════════════════════════════════════════════════════════════

app.get("/", async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const category = req.query.categoria || null;
    const search   = req.query.q?.toLowerCase() || null;
    const skip     = (page - 1) * PAGE_SIZE;

    const [{ rows, totalRows }, categories] = await Promise.all([
      getNewsList({ limit: PAGE_SIZE, skip, category }),
      getCategories(),
    ]);

    const filtered = search
      ? rows.filter(n =>
          n.web?.title?.toLowerCase().includes(search) ||
          n.web?.summary?.toLowerCase().includes(search) ||
          n.web?.tags?.some(t => t.toLowerCase().includes(search))
        )
      : rows;

    res.render("index", baseVars({
      news: filtered, categories,
      currentCat: category, search,
      page, totalPages: Math.ceil(totalRows / PAGE_SIZE), totalRows,
      title: category || (search ? `"${search}"` : null),
    }));
  } catch (e) {
    console.error("Error en /:", e);
    res.status(500).render("error", baseVars({ message: "Error cargando noticias" }));
  }
});

app.get("/noticia/:slug", async (req, res) => {
  try {
    const news = await getNewsBySlug(req.params.slug);
    if (!news) return res.status(404).render("error", baseVars({ message: "Noticia no encontrada" }));

    const { rows: related } = await getNewsList({ limit: 4, category: news.web?.category });
    const relatedFiltered   = related.filter(n => n._id !== news._id).slice(0, 3);

    const carouselUrls = [];
    if (news.carouselImages?.square) {
      news.carouselImages.square.forEach(imgPath => {
        carouselUrls.push(carouselImageUrl(news.botItemId, "square", path.basename(imgPath)));
      });
    }

    res.render("detail", baseVars({
      news, related: relatedFiltered, carouselUrls,
      title: news.web?.title,
      metaDesc: excerpt(news.web?.summary, 160),
      ogTitle: news.web?.title,
      ogDesc:  excerpt(news.web?.summary, 160),
    }));
  } catch (e) {
    console.error("Error en /noticia:", e);
    res.status(500).render("error", baseVars({ message: "Error cargando noticia" }));
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const category = req.query.categoria || null;
    const skip     = (page - 1) * PAGE_SIZE;
    const data     = await getNewsList({ limit: PAGE_SIZE, skip, category });
    res.json({ ok: true, ...data, page, pageSize: PAGE_SIZE });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/news/:slug", async (req, res) => {
  const news = await getNewsBySlug(req.params.slug);
  if (!news) return res.status(404).json({ ok: false, error: "No encontrada" });
  res.json({ ok: true, news });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), base: BASE_URL });
});

app.get("/instagram", async (req, res) => {
  try {
    const { rows } = await getNewsList({ limit: 12 });
    res.render("instagram", { news: rows, BASE_URL, formatDate, excerpt });
  } catch (e) {
    console.error("Error en /instagram:", e);
    res.status(500).send("Error");
  }
});


// ─── START ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐 Agro Parallel Blog: ${BASE_URL}`);
  console.log(`🔧 Admin panel: ${BASE_URL}/admin`);
  console.log(`🔒 Login: ${BASE_URL}/admin/login`);
  console.log(`🖼️  Carruseles: ${BASE_URL}/carruseles/`);
});

module.exports = app;
