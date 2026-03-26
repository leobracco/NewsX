require("dotenv").config();
const axios = require("axios");

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
        language: "es", // primero en español
        apiKey: NEWSAPI_KEY,
      },
      timeout: 10000,
    });

    let articles = response.data.articles || [];

    // Si no trajo nada en español, buscar en inglés
    if (articles.length === 0) {
      const en = await axios.get("https://newsapi.org/v2/everything", {
        params: {
          q: query,
          sortBy: "publishedAt",
          pageSize: 10,
          apiKey: NEWSAPI_KEY,
        },
        timeout: 10000,
      });
      articles = en.data.articles || [];
    }

    return articles;
  } catch (error) {
    console.error(
      `Error fetching "${query}":`,
      error.response?.data?.message || error.message,
    );
    return [];
  }
}

async function fetchAllNews(processedUrls = new Set()) {
  console.log("🌾 Buscando noticias agro...");

  // Usar más queries y no filtrar por fecha (plan gratis no lo soporta)
  const selectedQueries = shuffleArray(SEARCH_QUERIES).slice(0, 5);
  console.log("   Queries:", selectedQueries.join(" | "));

  const results = await Promise.allSettled(
    selectedQueries.map(fetchNewsFromAPI),
  );

  let all = [];
  results.forEach((r) => {
    if (r.status === "fulfilled") all = all.concat(r.value);
    if (r.status === "rejected") console.error("Query falló:", r.reason);
  });

  console.log(`   Raw articles: ${all.length}`);
  const unique = deduplicateByUrl(all, processedUrls);

  console.log(`✅ ${unique.length} artículos únicos válidos`);

  // Mostrar títulos para debug
  unique
    .slice(0, 5)
    .forEach((a, i) =>
      console.log(`   [${i + 1}] ${a.title?.substring(0, 80)}`),
    );

  return unique;
}

function deduplicateByUrl(articles, processedUrls = new Set()) {
  const seen = new Set(processedUrls);
  return articles.filter((a) => {
    if (!a.url || seen.has(a.url)) return false;
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
