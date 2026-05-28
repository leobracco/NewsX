require("dotenv").config();
const cron = require("node-cron");
const path = require("path");
const fs = require("fs");
const log = require("./logger");

const { fetchAllNews } = require("./newsFetcher");
const { processNewsWithAI } = require("./aiProcessor");
const { saveToQueue, getDailyReport, getPublishedUrls, markAsPublished, markAsFailed } = require("./storage");
const { generateAllFormats } = require("./carouselGenerator");
const {
  ensureDatabase,
  saveNewsToCouchDB,
} = require("./publishers/couchPublisher");
const { publishCarouselToFacebook, publishStoryToFacebook } = require("./publishers/facebookPublisher");
const {
  publishCarouselToInstagram,
  publishStoryToInstagram,
} = require("./publishers/instagramPublisher");

const CAROUSEL_DIR = process.env.CAROUSEL_OUTPUT_DIR
  ? path.resolve(process.env.CAROUSEL_OUTPUT_DIR)
  : path.join(__dirname, "../data/carousels");

// ─── FLAGS DE PUBLICACION ────────────────────────────────────────────
const PUBLISH = {
  couchdb: process.env.PUBLISH_COUCHDB !== "false",
  web: process.env.PUBLISH_WEB !== "false",
  facebook: process.env.PUBLISH_FACEBOOK === "true",
  instagram: process.env.PUBLISH_INSTAGRAM === "true",
};

// ─── LOCK para evitar ejecuciones concurrentes ──────────────────────
const LOCK_FILE = path.join(__dirname, "../data/.pipeline.lock");
let pipelineRunning = false;

function acquireLock() {
  if (pipelineRunning) return false;
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
      // Lock viejo (>30 min) = proceso muerto, limpiar
      if (ageMinutes > 30) {
        log.warn(`Lock viejo (${ageMinutes.toFixed(0)} min), limpiando`);
        fs.unlinkSync(LOCK_FILE);
      } else {
        return false;
      }
    }
    fs.writeFileSync(LOCK_FILE, `${process.pid}\n${new Date().toISOString()}`);
    pipelineRunning = true;
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  pipelineRunning = false;
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function logPublishConfig() {
  log.info(`Plataformas: CouchDB=${PUBLISH.couchdb ? "ON" : "OFF"} Web=${PUBLISH.web ? "ON" : "OFF"} FB=${PUBLISH.facebook ? "ON" : "OFF"} IG=${PUBLISH.instagram ? "ON" : "OFF"}`);
}

// ─── RETRY helper ───────────────────────────────────────────────────
async function withRetry(fn, label, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      log.warn(`${label} - intento ${attempt}/${maxRetries} fallo: ${err.message}`);
      if (attempt === maxRetries) throw err;
      const delay = attempt * 5000; // 5s, 10s, 15s
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── TIMEOUT helper ─────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} (${ms / 1000}s)`)), ms)
    ),
  ]);
}

// ─── VALIDACION DE INICIO ───────────────────────────────────────────
function validateConfig() {
  const required = [
    ["NEWSAPI_KEY", process.env.NEWSAPI_KEY],
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
  ];
  if (PUBLISH.couchdb) {
    required.push(
      ["COUCHDB_URL", process.env.COUCHDB_URL],
      ["COUCHDB_USER", process.env.COUCHDB_USER],
      ["COUCHDB_PASSWORD", process.env.COUCHDB_PASSWORD],
    );
  }
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    log.error(`Variables faltantes: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

// ─── PIPELINE PRINCIPAL ─────────────────────────────────────────────
async function runPipeline() {
  if (!acquireLock()) {
    log.warn("Pipeline ya en ejecucion, saltando");
    return;
  }

  const start = new Date();
  log.info("=" .repeat(50));
  log.info("AGRO PARALLEL BOT - Pipeline iniciado");
  logPublishConfig();

  try {
    // 0. Validar config
    if (!validateConfig()) {
      log.error("Configuracion invalida, abortando");
      return;
    }

    // 1. Init DB
    if (PUBLISH.couchdb) {
      await withRetry(
        () => withTimeout(ensureDatabase(), 15000, "ensureDatabase"),
        "CouchDB init",
        2,
      );
    }

    // 2. Buscar noticias
    const processedUrls = await getPublishedUrls();
    const raw = await withTimeout(fetchAllNews(processedUrls), 60000, "fetchAllNews");
    if (!raw.length) {
      log.warn("Sin articulos nuevos encontrados");
      return;
    }
    log.info(`${raw.length} articulos encontrados`);

    // 3. Procesar con IA
    const processed = await withTimeout(processNewsWithAI(raw), 120000, "processNewsWithAI");
    if (!processed.length) {
      log.warn("IA no genero contenido");
      return;
    }
    log.info(`${processed.length} noticias procesadas por IA`);

    // 4. Cola local
    const queued = await saveToQueue(processed);

    // 5. Publicar cada noticia
    let published = 0;
    for (const item of queued) {
      const title = item.generated?.web?.title || item.original.title;
      log.info(`Procesando: ${title}`);

      try {
        // Generar carruseles
        log.info("  Generando carruseles...");
        const carouselImages = await withTimeout(
          generateAllFormats(item, CAROUSEL_DIR),
          60000,
          "generateAllFormats",
        );
        item.carouselImages = carouselImages;

        // CouchDB
        if (PUBLISH.couchdb) {
          try {
            const saved = await withRetry(
              () => withTimeout(saveNewsToCouchDB(item), 15000, "saveNewsToCouchDB"),
              "CouchDB save",
              2,
            );
            if (saved) {
              await markAsPublished(item.id, "web");
              log.info(`  CouchDB: OK /noticia/${saved.slug}`);
            } else {
              log.warn("  CouchDB: documento ya existia");
            }
          } catch (e) {
            log.error(`  CouchDB: ${e.message}`);
            await markAsFailed(item.id, `CouchDB: ${e.message}`);
          }
        }

        // Facebook - Post carrusel
        if (PUBLISH.facebook) {
          const squareImages = carouselImages.square || [];
          if (squareImages.length) {
            try {
              const fb = await withRetry(
                () => withTimeout(publishCarouselToFacebook(item, squareImages), 30000, "Facebook"),
                "Facebook publish",
                2,
              );
              if (fb) {
                await markAsPublished(item.id, "facebook");
                log.info(`  Facebook post: OK ${fb.postId || ""}`);
              }
            } catch (e) {
              log.error(`  Facebook post: ${e.message}`);
            }
          }

          // Facebook - Story (usa la primera imagen en formato story)
          const storyImages = carouselImages.story || [];
          if (storyImages.length) {
            try {
              const fbStory = await withRetry(
                () => withTimeout(publishStoryToFacebook(item, storyImages[0]), 30000, "FB Story"),
                "Facebook story",
                2,
              );
              if (fbStory) {
                log.info(`  Facebook story: OK ${fbStory.postId || ""}`);
              }
            } catch (e) {
              log.error(`  Facebook story: ${e.message}`);
            }
          }
        }

        // Instagram - Post carrusel
        if (PUBLISH.instagram) {
          const vertImages = carouselImages.vertical || carouselImages.square || [];
          if (vertImages.length) {
            try {
              const ig = await withRetry(
                () => withTimeout(publishCarouselToInstagram(item, vertImages), 60000, "Instagram"),
                "Instagram publish",
                2,
              );
              if (ig) {
                await markAsPublished(item.id, "instagram");
                log.info(`  Instagram post: OK ${ig.mediaId || ""}`);
              }
            } catch (e) {
              log.error(`  Instagram post: ${e.message}`);
            }
          }

          // Instagram - Story (usa la primera imagen en formato story)
          const storyImages = carouselImages.story || [];
          if (storyImages.length) {
            try {
              const igStory = await withRetry(
                () => withTimeout(publishStoryToInstagram(item, storyImages[0]), 60000, "IG Story"),
                "Instagram story",
                2,
              );
              if (igStory) {
                log.info(`  Instagram story: OK ${igStory.mediaId || ""}`);
              }
            } catch (e) {
              log.error(`  Instagram story: ${e.message}`);
            }
          }
        }

        published++;
      } catch (e) {
        log.error(`  Error procesando "${title}": ${e.message}`);
        await markAsFailed(item.id, e.message);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    // 6. Resumen
    const secs = ((new Date() - start) / 1000).toFixed(1);
    log.info(`PIPELINE COMPLETADO en ${secs}s - ${published}/${queued.length} publicadas`);
    return queued;
  } catch (err) {
    log.error(`PIPELINE FALLO: ${err.message}`);
    log.error(err.stack || "");
  } finally {
    releaseLock();
  }
}

// ─── REPORTE ────────────────────────────────────────────────────────
async function printReport() {
  const r = await getDailyReport();
  log.info(`REPORTE ${r.date} | Total: ${r.total} | OK: ${r.published} | Pendiente: ${r.pending} | Error: ${r.failed}`);
}

// ─── SCHEDULER ──────────────────────────────────────────────────────
function startScheduler() {
  const opts = { timezone: "America/Argentina/Buenos_Aires" };

  // Una sola ejecucion diaria a las 8:00 AM Argentina
  cron.schedule(
    process.env.CRON_SCHEDULE_1 || "0 8 * * *",
    () => runPipeline().catch((e) => log.error(`Cron fallo: ${e.message}`)),
    opts,
  );

  cron.schedule("0 22 * * *", () => printReport().catch(console.error), opts);

  log.info("Bot activo - ejecucion diaria a las 08:00 (Argentina)");
  logPublishConfig();
}

// ─── ENTRY POINT ────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--run-now")) {
  log.info("Modo --run-now");
  runPipeline()
    .then(() => {
      log.info("Ejecucion manual completada");
      process.exit(0);
    })
    .catch((e) => {
      log.error(`Ejecucion manual fallo: ${e.message}`);
      process.exit(1);
    });
} else if (args.includes("--report")) {
  printReport().then(() => process.exit(0));
} else {
  startScheduler();
  // Ejecutar una vez al iniciar
  runPipeline().catch((e) => log.error(`Primera ejecucion fallo: ${e.message}`));
}

module.exports = { runPipeline, PUBLISH };
