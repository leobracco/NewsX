require("dotenv").config();
const cron = require("node-cron");
const path = require("path");

const { fetchAllNews } = require("./newsFetcher");
const { processNewsWithAI } = require("./aiProcessor");
const { saveToQueue, getDailyReport, getPublishedUrls } = require("./storage");
const { generateAllFormats } = require("./carouselGenerator");
const {
  ensureDatabase,
  saveNewsToCouchDB,
} = require("./publishers/couchPublisher");
const { publishCarouselToFacebook } = require("./publishers/facebookPublisher");
const {
  publishCarouselToInstagram,
} = require("./publishers/instagramPublisher");

const CAROUSEL_DIR = process.env.CAROUSEL_OUTPUT_DIR
  ? path.resolve(process.env.CAROUSEL_OUTPUT_DIR)
  : path.join(__dirname, "../data/carousels");

// ─── FLAGS DE PUBLICACIÓN ────────────────────────────────────────────
const PUBLISH = {
  couchdb: process.env.PUBLISH_COUCHDB !== "false",
  web: process.env.PUBLISH_WEB !== "false",
  facebook: process.env.PUBLISH_FACEBOOK === "true",
  instagram: process.env.PUBLISH_INSTAGRAM === "true",
};

function logPublishConfig() {
  console.log("\n📡 Plataformas activas:");
  console.log(`   CouchDB:   ${PUBLISH.couchdb ? "✅ ON" : "⏸️  OFF"}`);
  console.log(`   Web:       ${PUBLISH.web ? "✅ ON" : "⏸️  OFF"}`);
  console.log(`   Facebook:  ${PUBLISH.facebook ? "✅ ON" : "⏸️  OFF"}`);
  console.log(`   Instagram: ${PUBLISH.instagram ? "✅ ON" : "⏸️  OFF"}`);
}

// ─── PIPELINE PRINCIPAL ───────────────────────────────────────────────
async function runPipeline() {
  const start = new Date();
  console.log("\n" + "=".repeat(60));
  console.log("🌾 AGRO PARALLEL BOT — Pipeline iniciado");
  console.log(
    "📅 " +
      start.toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
      }),
  );
  logPublishConfig();
  console.log("=".repeat(60));

  try {
    // 0. Init DB si CouchDB está activo
    if (PUBLISH.couchdb) await ensureDatabase();

    // 1. Buscar noticias
    const processedUrls = await getPublishedUrls();
    const raw = await fetchAllNews(processedUrls);
    if (!raw.length) {
      console.log("⚠️  Sin artículos.");
      return;
    }

    // 2. Procesar con IA
    const processed = await processNewsWithAI(raw);
    if (!processed.length) {
      console.log("⚠️  Sin contenido procesado.");
      return;
    }

    // 3. Cola local (siempre se guarda)
    const queued = await saveToQueue(processed);

    // 4. Por cada noticia
    const results = [];
    for (const item of queued) {
      const title = item.generated?.web?.title || item.original.title;
      console.log(`\n📌 ${title}`);
      const itemResult = { title, published: {} };

      // Generar carruseles (siempre, para tener los archivos disponibles)
      console.log("  🖼️  Generando carruseles...");
      const carouselImages = await generateAllFormats(item, CAROUSEL_DIR);
      item.carouselImages = carouselImages;

      // ── CouchDB ──────────────────────────────
      if (PUBLISH.couchdb) {
        const saved = await saveNewsToCouchDB(item);
        itemResult.published.couchdb = saved
          ? `✅ /noticia/${saved.slug}`
          : "❌ Error";
        console.log(`  💾 CouchDB: ${itemResult.published.couchdb}`);
      } else {
        console.log("  💾 CouchDB: ⏸️  omitido");
      }

      // ── Facebook ─────────────────────────────
      if (PUBLISH.facebook) {
        const squareImages = carouselImages.square || [];
        if (squareImages.length) {
          const fb = await publishCarouselToFacebook(item, squareImages);
          itemResult.published.facebook = fb
            ? `✅ ${fb.url || fb.postId}`
            : "❌ Error";
          console.log(`  📘 Facebook: ${itemResult.published.facebook}`);
        }
      } else {
        console.log("  📘 Facebook: ⏸️  omitido");
      }

      // ── Instagram ────────────────────────────
      if (PUBLISH.instagram) {
        const vertImages =
          carouselImages.vertical || carouselImages.square || [];
        if (vertImages.length) {
          const ig = await publishCarouselToInstagram(item, vertImages);
          itemResult.published.instagram = ig
            ? `✅ ${ig.url || ig.mediaId}`
            : "❌ Error";
          console.log(`  📸 Instagram: ${itemResult.published.instagram}`);
        }
      } else {
        console.log("  📸 Instagram: ⏸️  omitido");
      }

      results.push(itemResult);
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 5. Resumen
    const secs = ((new Date() - start) / 1000).toFixed(1);
    console.log("\n" + "=".repeat(60));
    console.log(`✅ PIPELINE COMPLETADO en ${secs}s`);
    results.forEach((r) => {
      console.log(`\n   📰 ${r.title}`);
      Object.entries(r.published).forEach(([k, v]) =>
        console.log(`      ${k}: ${v}`),
      );
    });
    console.log("=".repeat(60));

    return queued;
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

// ─── REPORTE ─────────────────────────────────────────────────────────
async function printReport() {
  const r = await getDailyReport();
  console.log(`\n📊 REPORTE ${r.date}`);
  console.log(
    `   Total: ${r.total} | ✅ ${r.published} | ⏳ ${r.pending} | ❌ ${r.failed}`,
  );
  logPublishConfig();
}

// ─── SCHEDULER ───────────────────────────────────────────────────────
function startScheduler() {
  const opts = { timezone: "America/Argentina/Buenos_Aires" };
  cron.schedule(
    process.env.CRON_SCHEDULE_1 || "0 7  * * *",
    () => runPipeline(),
    opts,
  );
  cron.schedule(
    process.env.CRON_SCHEDULE_2 || "0 13 * * *",
    () => runPipeline(),
    opts,
  );
  cron.schedule(
    process.env.CRON_SCHEDULE_3 || "0 19 * * *",
    () => runPipeline(),
    opts,
  );
  cron.schedule("0 22 * * *", printReport, opts);
  console.log("⏰ Bot activo · 07:00 · 13:00 · 19:00 (Argentina)");
  logPublishConfig();
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes("--run-now")) {
  runPipeline()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else if (args.includes("--report")) {
  printReport().then(() => process.exit(0));
} else {
  startScheduler();
  runPipeline().catch(console.error);
}

module.exports = { runPipeline, PUBLISH };
