require("dotenv").config();
const express     = require("express");

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

// Genera la URL pública de una imagen del carrusel
function carouselImageUrl(itemId, format, filename) {
  return `${BASE_URL}/carruseles/${itemId}/${format}/${filename}`;
}

// ─── RUTAS ───────────────────────────────────────────────────────────

// Variables comunes para todas las vistas (incluido el layout)
function baseVars(extra = {}) {
  return {
    title: undefined, metaDesc: undefined,
    ogTitle: undefined, ogDesc: undefined,
    search: null, BASE_URL,
    formatDate, excerpt,
    ...extra,
  };
}

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

// ─── START ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐 Agro Parallel Blog corriendo en ${BASE_URL}`);
  console.log(`🖼️  Carruseles servidos en ${BASE_URL}/carruseles/`);
});

module.exports = app;

// ─── LINK IN BIO ──────────────────────────────────────────────────────
app.get("/instagram", async (req, res) => {
  try {
    const { rows } = await getNewsList({ limit: 12 });
    res.render("instagram", { news: rows, BASE_URL, formatDate, excerpt });
  } catch (e) {
    console.error("Error en /instagram:", e);
    res.status(500).send("Error");
  }
});

// ─── ADMIN: VISOR DE CARRUSELES ───────────────────────────────────────
app.get("/admin/carruseles", async (req, res) => {
  try {
    const { rows } = await getNewsList({ limit: 20 });
    const fsSync   = require("fs");

    const newsWithSlides = rows.map(item => {
      const slides  = {};
      const formats = ["square", "vertical", "horizontal", "story"];
      formats.forEach(fmt => {
        const dir = path.join(carouselDir, item.botItemId || "", fmt);
        try {
          slides[fmt] = fsSync.readdirSync(dir).filter(f => f.endsWith(".png")).sort();
        } catch {
          slides[fmt] = [];
        }
      });
      return { ...item, slides };
    });

    res.render("admin_carousels", { news: newsWithSlides, BASE_URL, formatDate, excerpt });
  } catch (e) {
    console.error("Error en /admin/carruseles:", e);
    res.status(500).send("Error");
  }
});
