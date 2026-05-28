require("dotenv").config();
const axios = require("axios");
const log = require("./logger");

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

const SEARCH_QUERIES = [
  "agricultura tecnología innovación",
  "precision farming technology",
  "agtech crop innovation",
  "soja maíz trigo mercado",
  "ganadería sostenible",
  "drones agriculture spray",
  "smart farming IoT crops",
  "biotechnology seeds",
  "fertilizantes biológicos",
  "cambio climático agricultura",
];

async function fetchNewsFromAPI(query) {
  try {
    const response = await axios.get("https://newsapi.org/v2/everything", {
      params: {
        q: query,
        sortBy: "publishedAt",
        pageSize: 10,
        language: "es",
        apiKey: NEWSAPI_KEY,
      },
      timeout: 20000,
    });

    let articles = response.data.articles || [];

    // Si no trajo nada en espanol, buscar en ingles
    if (articles.length === 0) {
      const en = await axios.get("https://newsapi.org/v2/everything", {
        params: {
          q: query,
          sortBy: "publishedAt",
          pageSize: 10,
          apiKey: NEWSAPI_KEY,
        },
        timeout: 20000,
      });
      articles = en.data.articles || [];
    }

    return articles;
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    log.warn(`Fetch "${query}" fallo: ${msg}`);
    return [];
  }
}

async function fetchAllNews(processedUrls = new Set()) {
  log.info("Buscando noticias agro...");

  if (!NEWSAPI_KEY) {
    log.error("NEWSAPI_KEY no configurada");
    return [];
  }

  const selectedQueries = shuffleArray(SEARCH_QUERIES).slice(0, 5);
  log.info(`Queries: ${selectedQueries.join(" | ")}`);

  const results = await Promise.allSettled(
    selectedQueries.map(fetchNewsFromAPI),
  );

  let all = [];
  let failed = 0;
  results.forEach((r) => {
    if (r.status === "fulfilled") all = all.concat(r.value);
    if (r.status === "rejected") {
      failed++;
      log.warn(`Query fallo: ${r.reason?.message || r.reason}`);
    }
  });

  if (failed === results.length) {
    log.error("TODAS las queries fallaron - posible problema con NewsAPI");
  }

  log.info(`Raw articles: ${all.length}`);
  const unique = deduplicateByUrl(all, processedUrls);

  log.info(`${unique.length} articulos unicos validos`);
  unique.slice(0, 5).forEach((a, i) =>
    log.info(`  [${i + 1}] ${a.title?.substring(0, 80)}`),
  );

  return unique;
}

function deduplicateByUrl(articles, processedUrls = new Set()) {
  const seen = new Set(processedUrls);
  return articles.filter((a) => {
    if (!a.url || seen.has(a.url)) return false;
    if (a.title === "[Removed]") return false;
    seen.add(a.url);
    return true;
  });
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { fetchAllNews };
