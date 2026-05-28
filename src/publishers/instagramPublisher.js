require("dotenv").config();
const axios = require("axios");
const path  = require("path");
const log   = require("../logger");

const GRAPH_URL  = "https://graph.facebook.com/v21.0";
const IG_ID      = process.env.INSTAGRAM_ACCOUNT_ID;
const PAGE_TOKEN = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
const BASE_URL   = process.env.WEB_BASE_URL || "http://localhost:3000";

/**
 * Construye la URL publica de una imagen del carrusel
 */
function buildImageUrl(itemId, format, imagePath) {
  const filename = path.basename(imagePath);
  return `${BASE_URL}/carruseles/${itemId}/${format}/${filename}`;
}

// ─── PUBLICAR CARRUSEL EN INSTAGRAM ─────────────────────────────────
async function publishCarouselToInstagram(newsItem, imagePaths, format = "vertical") {
  if (!IG_ID || !PAGE_TOKEN) {
    log.warn("IG: credenciales no configuradas, saltando");
    return null;
  }
  if (!BASE_URL.startsWith("https://")) {
    log.warn("IG: WEB_BASE_URL debe ser HTTPS para publicar imagenes");
    return null;
  }

  const slides = imagePaths.slice(0, 10); // Instagram: maximo 10

  try {
    const { generated } = newsItem;
    const caption = `${generated.instagram.caption}\n\n${generated.instagram.hashtags}`;

    // 1. Crear container por cada imagen
    log.info(`  IG: creando ${slides.length} containers...`);
    const itemIds = [];

    for (const imgPath of slides) {
      const imageUrl = buildImageUrl(newsItem.id, format, imgPath);
      const itemId = await createMediaContainer({
        image_url: imageUrl,
        is_carousel_item: true,
      });
      if (itemId) itemIds.push(itemId);
      await sleep(500);
    }

    if (itemIds.length < 2) {
      throw new Error(`Minimo 2 imagenes para carrusel, se obtuvieron: ${itemIds.length}`);
    }

    // 2. Crear container del carrusel
    log.info("  IG: creando container carrusel...");
    const carouselId = await createMediaContainer({
      media_type: "CAROUSEL",
      children: itemIds.join(","),
      caption,
    });
    if (!carouselId) throw new Error("No se pudo crear container del carrusel");

    // 3. Esperar que este listo
    await waitForContainer(carouselId);

    // 4. Publicar
    log.info("  IG: publicando...");
    const res = await axios.post(`${GRAPH_URL}/${IG_ID}/media_publish`, {
      creation_id:  carouselId,
      access_token: PAGE_TOKEN,
    });

    const mediaId = res.data.id;
    const postUrl = await getInstagramPostUrl(mediaId);
    log.info(`  IG: publicado ${postUrl || mediaId}`);
    return { platform: "instagram", mediaId, url: postUrl };

  } catch (e) {
    log.error(`  IG error: ${e.response?.data?.error?.message || e.message}`);
    return null;
  }
}

// ─── PUBLICAR STORY EN INSTAGRAM ────────────────────────────────────
async function publishStoryToInstagram(newsItem, storyImagePath, format = "story") {
  if (!IG_ID || !PAGE_TOKEN) {
    log.warn("IG Story: credenciales no configuradas, saltando");
    return null;
  }
  if (!BASE_URL.startsWith("https://")) {
    log.warn("IG Story: WEB_BASE_URL debe ser HTTPS");
    return null;
  }

  try {
    const imageUrl = buildImageUrl(newsItem.id, format, storyImagePath);
    log.info(`  IG Story: creando container...`);

    // 1. Crear container de tipo STORIES
    const containerId = await createMediaContainer({
      media_type: "STORIES",
      image_url: imageUrl,
    });

    if (!containerId) throw new Error("No se pudo crear container de story");

    // 2. Esperar que este listo
    await waitForContainer(containerId);

    // 3. Publicar
    log.info("  IG Story: publicando...");
    const res = await axios.post(`${GRAPH_URL}/${IG_ID}/media_publish`, {
      creation_id:  containerId,
      access_token: PAGE_TOKEN,
    });

    const mediaId = res.data.id;
    log.info(`  IG Story: publicado [${mediaId}]`);
    return { platform: "instagram_story", mediaId };

  } catch (e) {
    log.error(`  IG Story error: ${e.response?.data?.error?.message || e.message}`);
    return null;
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────

async function createMediaContainer(params) {
  try {
    const res = await axios.post(`${GRAPH_URL}/${IG_ID}/media`, {
      ...params,
      access_token: PAGE_TOKEN,
    });
    return res.data.id;
  } catch (e) {
    log.error(`  IG container error: ${e.response?.data?.error?.message || e.message}`);
    return null;
  }
}

async function waitForContainer(containerId, maxRetries = 15) {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(3000);
    try {
      const res = await axios.get(`${GRAPH_URL}/${containerId}`, {
        params: { fields: "status_code", access_token: PAGE_TOKEN },
      });
      const status = res.data.status_code;
      if (status === "FINISHED") return true;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new Error(`Container status: ${status}`);
      }
      log.info(`  IG: esperando container ${status} (${i + 1}/${maxRetries})`);
    } catch (e) {
      if (e.message.includes("Container status:")) throw e;
      log.warn(`  IG: error chequeando container (intento ${i + 1})`);
    }
  }
  throw new Error("Timeout esperando container de Instagram");
}

async function getInstagramPostUrl(mediaId) {
  try {
    const res = await axios.get(`${GRAPH_URL}/${mediaId}`, {
      params: { fields: "permalink", access_token: PAGE_TOKEN },
    });
    return res.data.permalink;
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { publishCarouselToInstagram, publishStoryToInstagram };
