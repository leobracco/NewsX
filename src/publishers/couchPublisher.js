require("dotenv").config();
const axios = require("axios");

const COUCH_URL  = process.env.COUCHDB_URL      || "http://localhost:5984";
const COUCH_USER = process.env.COUCHDB_USER      || "admin";
const COUCH_PASS = process.env.COUCHDB_PASSWORD  || "password";
const DB_NAME    = process.env.COUCHDB_DB        || "agro_parallel_news";

const couch = axios.create({
  baseURL: COUCH_URL,
  auth: { username: COUCH_USER, password: COUCH_PASS },
  headers: { "Content-Type": "application/json" },
});

// ─── INIT DB ─────────────────────────────────────────────────────────
async function ensureDatabase() {
  try {
    await couch.put(`/${DB_NAME}`);
    console.log(`✅ Base de datos "${DB_NAME}" creada`);
  } catch (e) {
    if (e.response?.status === 412) {
      // Ya existe, OK
    } else {
      throw new Error(`Error creando DB: ${e.message}`);
    }
  }

  // Crear índices/vistas necesarias
  await ensureDesignDoc();
}

async function ensureDesignDoc() {
  const ddoc = {
    _id: "_design/news",
    views: {
      by_date: {
        map: `function(doc) {
          if (doc.type === "news") {
            emit(doc.publishedAt, {
              title: doc.web.title,
              summary: doc.web.summary,
              category: doc.web.category,
              tags: doc.web.tags,
              source: doc.source,
              slug: doc.slug
            });
          }
        }`,
      },
      by_category: {
        map: `function(doc) {
          if (doc.type === "news") {
            emit([doc.web.category, doc.publishedAt], {
              title: doc.web.title,
              summary: doc.web.summary,
              slug: doc.slug
            });
          }
        }`,
      },
      by_slug: {
        map: `function(doc) {
          if (doc.type === "news" && doc.slug) {
            emit(doc.slug, null);
          }
        }`,
      },
    },
  };

  try {
    // Verificar si ya existe
    const existing = await couch.get(`/${DB_NAME}/_design/news`);
    ddoc._rev = existing.data._rev;
    await couch.put(`/${DB_NAME}/_design/news`, ddoc);
  } catch (e) {
    if (e.response?.status === 404) {
      await couch.put(`/${DB_NAME}/_design/news`, ddoc);
      console.log("✅ Design document creado");
    }
  }
}

// ─── SAVE NEWS ───────────────────────────────────────────────────────
async function saveNewsToCouchDB(newsItem) {
  const { generated, original, id, createdAt } = newsItem;

  const slug = generateSlug(generated.web.title) + "-" + Date.now();

  const doc = {
    _id:         `news_${id}`,
    type:        "news",
    slug,
    publishedAt: createdAt,
    source: {
      name: original.source?.name || "Internacional",
      url:  original.url,
    },
    web: {
      title:    generated.web.title,
      summary:  generated.web.summary,
      tags:     generated.web.tags,
      category: generated.web.category,
    },
    carousel: generated.carousel,
    instagram: generated.instagram,
    facebook:  generated.facebook,
    carouselImages: newsItem.carouselImages || {},
    botItemId: id,
  };

  try {
    const res = await couch.put(`/${DB_NAME}/${doc._id}`, doc);
    console.log(`  💾 CouchDB: guardado "${doc.web.title}" [${slug}]`);
    return { ...doc, _rev: res.data.rev };
  } catch (e) {
    if (e.response?.status === 409) {
      console.log(`  ⚠️  CouchDB: documento ya existe, saltando`);
      return null;
    }
    throw new Error(`Error guardando en CouchDB: ${e.message}`);
  }
}

// ─── GET NEWS (para la web) ───────────────────────────────────────────
async function getNewsList({ limit = 10, skip = 0, category = null } = {}) {
  try {
    let url, params;

    if (category) {
      url    = `/${DB_NAME}/_design/news/_view/by_category`;
      params = {
        descending: false,
        startkey:   JSON.stringify([category, "\ufff0"]),
        endkey:     JSON.stringify([category, ""]),
        limit,
        skip,
        include_docs: true,
      };
      // Para by_category en orden descendente necesitamos invertir
      params = {
        startkey:     JSON.stringify([category, "\ufff0"]),
        endkey:       JSON.stringify([category, ""]),
        descending:   true,
        limit,
        skip,
        include_docs: true,
      };
    } else {
      url    = `/${DB_NAME}/_design/news/_view/by_date`;
      params = { descending: true, limit, skip, include_docs: true };
    }

    const res = await couch.get(url, { params });
    return {
      rows:       res.data.rows.map(r => r.doc),
      totalRows:  res.data.total_rows,
      offset:     res.data.offset,
    };
  } catch (e) {
    console.error("Error obteniendo noticias:", e.message);
    return { rows: [], totalRows: 0, offset: 0 };
  }
}

async function getNewsBySlug(slug) {
  try {
    const res = await couch.get(`/${DB_NAME}/_design/news/_view/by_slug`, {
      params: { key: JSON.stringify(slug), include_docs: true },
    });
    if (res.data.rows.length === 0) return null;
    return res.data.rows[0].doc;
  } catch (e) {
    return null;
  }
}

async function getCategories() {
  try {
    const res = await couch.get(`/${DB_NAME}/_design/news/_view/by_category`, {
      params: { group_level: 1, group: true },
    });
    return res.data.rows.map(r => ({ category: r.key[0], count: r.value }));
  } catch {
    return [];
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────
function generateSlug(title) {
  return title
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

module.exports = {
  ensureDatabase,
  saveNewsToCouchDB,
  getNewsList,
  getNewsBySlug,
  getCategories,
};
