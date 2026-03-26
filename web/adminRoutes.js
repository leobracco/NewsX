/**
 * AGRO PARALLEL — Admin Routes
 * Rutas para el panel de administración
 * Se monta en el server.js principal con: require('./adminRoutes')(app)
 */

const path = require("path");
const fs   = require("fs");

const {
  getNewsList,
  getNewsBySlug,
  getCategories,
} = require("../src/publishers/couchPublisher");

const PAGE_SIZE = 20;

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

module.exports = function mountAdmin(app) {

  const COUCH_URL  = process.env.COUCHDB_URL     || "http://localhost:5984";
  const COUCH_USER = process.env.COUCHDB_USER     || "admin";
  const COUCH_PASS = process.env.COUCHDB_PASSWORD || "password";
  const DB_NAME    = process.env.COUCHDB_DB       || "agro_parallel_news";
  const BASE_URL   = process.env.WEB_BASE_URL     || "http://localhost:3000";

  const carouselDir = process.env.CAROUSEL_OUTPUT_DIR
    ? path.resolve(process.env.CAROUSEL_OUTPUT_DIR)
    : path.join(__dirname, "../data/carousels");

  // Helper: CouchDB request via fetch or axios
  let axios;
  try { axios = require("axios"); } catch { /* fallback below */ }

  function couchRequest(method, docPath, data) {
    const url = `${COUCH_URL}/${DB_NAME}/${docPath}`;
    return axios({
      method, url, data,
      auth: { username: COUCH_USER, password: COUCH_PASS },
      headers: { "Content-Type": "application/json" },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  VIEWS
  // ═══════════════════════════════════════════════════════════════════

  // ── Dashboard ──
  app.get("/admin", async (req, res) => {
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
            n.web?.tags?.some(t => t.toLowerCase().includes(search))
          )
        : rows;

      // Stats
      const allItems = await getNewsList({ limit: 1000 });
      const stats = {
        total:      allItems.totalRows || filtered.length,
        published:  allItems.rows?.filter(n => n.publishedTo?.length > 0).length || 0,
        pending:    allItems.rows?.filter(n => !n.publishedTo?.length).length || allItems.totalRows,
        categories: categories.length,
        lastUpdate: filtered[0] ? formatDate(filtered[0].publishedAt) : null,
      };

      res.render("admin_dashboard", {
        news: filtered,
        categories,
        currentCat: category,
        search,
        page,
        totalPages: Math.ceil(totalRows / PAGE_SIZE),
        totalRows,
        stats,
        formatDate,
        excerpt,
        BASE_URL,
      });
    } catch (e) {
      console.error("Admin error:", e);
      res.status(500).send("Error cargando admin: " + e.message);
    }
  });

  // ── Edit view ──
  app.get("/admin/edit/:slug", async (req, res) => {
    try {
      const news = await getNewsBySlug(req.params.slug);
      if (!news) return res.status(404).send("Publicación no encontrada");

      // Carousel images
      const carouselUrls = [];
      if (news.botItemId) {
        const fmts = ["square", "vertical", "horizontal", "story"];
        for (const fmt of fmts) {
          const dir = path.join(carouselDir, news.botItemId, fmt);
          try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith(".png")).sort();
            if (files.length && carouselUrls.length === 0) {
              // Use first available format
              files.forEach(f => {
                carouselUrls.push(`${BASE_URL}/carruseles/${news.botItemId}/${fmt}/${f}`);
              });
            }
          } catch {}
        }
      }

      res.render("admin_edit", {
        news,
        carouselUrls,
        formatDate,
        excerpt,
        BASE_URL,
      });
    } catch (e) {
      console.error("Admin edit error:", e);
      res.status(500).send("Error: " + e.message);
    }
  });

  // ── Pipeline trigger page ──
  app.get("/admin/pipeline", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pipeline · Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/admin.css">
</head>
<body class="admin-body">
<header class="admin-topbar">
  <a href="/admin" class="admin-logo">AGRO <span>PARALLEL</span> <span class="badge">Admin</span></a>
  <a href="/admin" class="admin-topbar-link">← Volver</a>
</header>
<div style="max-width:600px;margin:60px auto;text-align:center;padding:0 20px">
  <div style="font-size:3rem;margin-bottom:16px">⚡</div>
  <h1 style="font-family:'Barlow Condensed',sans-serif;font-size:2rem;margin-bottom:12px">
    Ejecutar <span style="color:#6DC231">Pipeline</span>
  </h1>
  <p style="color:#A0A8C0;margin-bottom:28px;font-size:.9rem;line-height:1.6">
    Esto buscará noticias nuevas, las procesará con IA, generará carruseles y las guardará en la base de datos.
  </p>
  <button class="btn btn-green" style="font-size:1rem;padding:14px 32px" onclick="runPipeline()" id="runBtn">
    🚀 Ejecutar ahora
  </button>
  <pre id="logOutput" style="margin-top:24px;text-align:left;background:#1A1C26;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:20px;font-family:'JetBrains Mono',monospace;font-size:.78rem;color:#A0A8C0;max-height:400px;overflow-y:auto;display:none"></pre>
</div>
<script>
async function runPipeline() {
  const btn = document.getElementById('runBtn');
  const log = document.getElementById('logOutput');
  btn.disabled = true;
  btn.textContent = '⏳ Ejecutando...';
  log.style.display = 'block';
  log.textContent = '🌾 Iniciando pipeline...\\n';
  try {
    const res = await fetch('/api/admin/pipeline', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      log.textContent += '✅ Pipeline completado\\n';
      log.textContent += 'Procesadas: ' + (data.processed || 0) + ' noticias\\n';
      btn.textContent = '✅ Completado';
      setTimeout(() => window.location.href = '/admin', 2000);
    } else {
      log.textContent += '❌ Error: ' + (data.error || 'desconocido') + '\\n';
      btn.textContent = '❌ Error';
    }
  } catch (e) {
    log.textContent += '❌ Error de conexión\\n';
    btn.textContent = '🚀 Reintentar';
  }
  btn.disabled = false;
}
</script>
</body></html>`);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  API ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════

  // ── UPDATE news item ──
  app.put("/api/admin/news/:id", async (req, res) => {
    try {
      // Get current doc
      const docRes = await couchRequest("GET", req.params.id);
      const doc = docRes.data;

      // Merge changes
      const updates = req.body;
      if (updates.web) {
        doc.web = { ...doc.web, ...updates.web };
      }
      if (updates.instagram) {
        doc.instagram = { ...doc.instagram, ...updates.instagram };
      }
      if (updates.facebook) {
        doc.facebook = { ...doc.facebook, ...updates.facebook };
      }
      if (updates.carousel) {
        doc.carousel = { ...doc.carousel, ...updates.carousel };
      }

      doc.updatedAt = new Date().toISOString();

      // Save
      const saveRes = await couchRequest("PUT", req.params.id, doc);
      res.json({ ok: true, rev: saveRes.data.rev });
    } catch (e) {
      console.error("API update error:", e.response?.data || e.message);
      res.status(500).json({ ok: false, error: e.response?.data?.reason || e.message });
    }
  });

  // ── DELETE news item ──
  app.delete("/api/admin/news/:id", async (req, res) => {
    try {
      // Get current rev
      const docRes = await couchRequest("GET", req.params.id);
      const rev = docRes.data._rev;

      // Delete
      await couchRequest("DELETE", `${req.params.id}?rev=${rev}`);

      // Also try to remove carousel files
      const botItemId = docRes.data.botItemId;
      if (botItemId) {
        const itemDir = path.join(carouselDir, botItemId);
        try {
          fs.rmSync(itemDir, { recursive: true, force: true });
          console.log(`  🗑️ Carruseles eliminados: ${itemDir}`);
        } catch {}
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("API delete error:", e.response?.data || e.message);
      res.status(500).json({ ok: false, error: e.response?.data?.reason || e.message });
    }
  });

  // ── PUBLISH to platform ──
  app.post("/api/admin/publish/:id", async (req, res) => {
    const { platform } = req.body;
    try {
      // Get doc
      const docRes = await couchRequest("GET", req.params.id);
      const doc = docRes.data;

      if (platform === "instagram") {
        // Try to publish via instagramPublisher
        try {
          const { publishCarouselToInstagram } = require("../src/publishers/instagramPublisher");
          const verticalDir = path.join(carouselDir, doc.botItemId || "", "vertical");
          let imagePaths = [];
          try {
            imagePaths = fs.readdirSync(verticalDir)
              .filter(f => f.endsWith(".png")).sort()
              .map(f => path.join(verticalDir, f));
          } catch {}

          if (imagePaths.length < 2) {
            return res.json({ ok: false, error: "Se necesitan al menos 2 slides" });
          }

          const result = await publishCarouselToInstagram(
            { id: doc.botItemId, generated: doc, original: { url: doc.source?.url } },
            imagePaths,
            "vertical"
          );
          if (result) {
            // Update doc
            if (!doc.publishedTo) doc.publishedTo = [];
            if (!doc.publishedTo.includes("instagram")) doc.publishedTo.push("instagram");
            doc.instagramResult = result;
            await couchRequest("PUT", req.params.id, doc);
            return res.json({ ok: true, result });
          }
          return res.json({ ok: false, error: "No se pudo publicar" });
        } catch (e) {
          return res.json({ ok: false, error: e.message });
        }
      }

      if (platform === "facebook") {
        try {
          const { publishCarouselToFacebook } = require("../src/publishers/facebookPublisher");
          const squareDir = path.join(carouselDir, doc.botItemId || "", "square");
          let imagePaths = [];
          try {
            imagePaths = fs.readdirSync(squareDir)
              .filter(f => f.endsWith(".png")).sort()
              .map(f => path.join(squareDir, f));
          } catch {}

          const result = await publishCarouselToFacebook(
            { generated: doc, original: { url: doc.source?.url } },
            imagePaths
          );
          if (result) {
            if (!doc.publishedTo) doc.publishedTo = [];
            if (!doc.publishedTo.includes("facebook")) doc.publishedTo.push("facebook");
            doc.facebookResult = result;
            await couchRequest("PUT", req.params.id, doc);
            return res.json({ ok: true, result });
          }
          return res.json({ ok: false, error: "No se pudo publicar" });
        } catch (e) {
          return res.json({ ok: false, error: e.message });
        }
      }

      res.json({ ok: false, error: `Plataforma "${platform}" no soportada aún` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── REGENERATE carousel ──
  app.post("/api/admin/regenerate-carousel/:id", async (req, res) => {
    try {
      const docRes = await couchRequest("GET", req.params.id);
      const doc = docRes.data;

      if (!doc.carousel || !doc.botItemId) {
        return res.json({ ok: false, error: "Sin datos de carrusel" });
      }

      const { generateAllFormats } = require("../src/carouselGenerator");
      const newsItem = {
        id: doc.botItemId,
        generated: { carousel: doc.carousel },
        original: { source: doc.source, url: doc.source?.url },
      };

      const results = await generateAllFormats(newsItem, carouselDir);

      // Update doc with new paths
      doc.carouselImages = results;
      doc.carouselRegenAt = new Date().toISOString();
      await couchRequest("PUT", req.params.id, doc);

      res.json({ ok: true, formats: Object.keys(results) });
    } catch (e) {
      console.error("Regenerate error:", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── RUN PIPELINE ──
  app.post("/api/admin/pipeline", async (req, res) => {
    try {
      const { runPipeline } = require("../src/scheduler");
      const result = await runPipeline();
      res.json({ ok: true, processed: result?.length || 0 });
    } catch (e) {
      console.error("Pipeline error:", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── GET single news (API) ──
  app.get("/api/admin/news/:id", async (req, res) => {
    try {
      const docRes = await couchRequest("GET", req.params.id);
      res.json({ ok: true, news: docRes.data });
    } catch (e) {
      res.status(404).json({ ok: false, error: "No encontrada" });
    }
  });

  console.log("🔧 Admin routes mounted at /admin");
};
