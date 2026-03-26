require("dotenv").config();
const axios = require("axios");
const path  = require("path");

const GRAPH_URL  = "https://graph.facebook.com/v19.0";
const IG_ID      = process.env.INSTAGRAM_ACCOUNT_ID;
const PAGE_TOKEN = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
const BASE_URL   = process.env.WEB_BASE_URL   || "http://localhost:3000";

/**
 * Construye la URL pública de una imagen del carrusel
 * Ej: https://blog.agroparallel.com/carruseles/abc123/vertical/slide_01.png
 */
function buildImageUrl(itemId, format, imagePath) {
  const filename = path.basename(imagePath);
  return `${BASE_URL}/carruseles/${itemId}/${format}/${filename}`;
}

async function publishCarouselToInstagram(newsItem, imagePaths, format = "vertical") {
  if (!IG_ID || !PAGE_TOKEN) {
    console.log("  ⚠️  Instagram: credenciales no configuradas, saltando");
    return null;
  }
  if (!BASE_URL.startsWith("https://")) {
    console.log("  ⚠️  Instagram: WEB_BASE_URL debe ser HTTPS para publicar imágenes");
    return null;
  }

  const slides = imagePaths.slice(0, 10); // Instagram: máximo 10

  try {
    const { generated } = newsItem;
    const caption = `${generated.instagram.caption}\n\n${generated.instagram.hashtags}`;

    // 1. Crear container por cada imagen
    console.log(`  📤 Instagram: creando ${slides.length} containers...`);
    const itemIds = [];

    for (const imgPath of slides) {
      const imageUrl = buildImageUrl(newsItem.id, format, imgPath);
      console.log(`     → ${imageUrl}`);
      const itemId = await createCarouselItem(imageUrl);
      if (itemId) itemIds.push(itemId);
      await sleep(500);
    }

    if (itemIds.length < 2) {
      throw new Error(`Mínimo 2 imágenes para carrusel, se obtuvieron: ${itemIds.length}`);
    }

    // 2. Crear container del carrusel
    console.log(`  🔗 Instagram: creando container carrusel...`);
    const carouselId = await createCarouselContainer(itemIds, caption);
    if (!carouselId) throw new Error("No se pudo crear container del carrusel");

    // 3. Esperar que esté listo
    await waitForContainer(carouselId);

    // 4. Publicar
    console.log(`  🚀 Instagram: publicando...`);
    const res = await axios.post(`${GRAPH_URL}/${IG_ID}/media_publish`, {
      creation_id:  carouselId,
      access_token: PAGE_TOKEN,
    });

    const mediaId = res.data.id;
    const postUrl = await getInstagramPostUrl(mediaId);
    console.log(`  ✅ Instagram publicado: ${postUrl}`);
    return { platform: "instagram", mediaId, url: postUrl };

  } catch (e) {
    console.error("  ❌ Instagram error:", e.response?.data?.error?.message || e.message);
    return null;
  }
}

async function createCarouselItem(imageUrl) {
  try {
    const res = await axios.post(`${GRAPH_URL}/${IG_ID}/media`, {
      image_url:        imageUrl,
      is_carousel_item: true,
      access_token:     PAGE_TOKEN,
    });
    return res.data.id;
  } catch (e) {
    console.error("  ❌ Error creando carousel item:", e.response?.data?.error?.message || e.message);
    return null;
  }
}

async function createCarouselContainer(itemIds, caption) {
  try {
    const res = await axios.post(`${GRAPH_URL}/${IG_ID}/media`, {
      media_type:   "CAROUSEL",
      children:     itemIds.join(","),
      caption,
      access_token: PAGE_TOKEN,
    });
    return res.data.id;
  } catch (e) {
    console.error("  ❌ Error creando container:", e.response?.data?.error?.message || e.message);
    return null;
  }
}

async function waitForContainer(containerId, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(3000);
    try {
      const res = await axios.get(`${GRAPH_URL}/${containerId}`, {
        params: { fields: "status_code", access_token: PAGE_TOKEN },
      });
      const status = res.data.status_code;
      if (status === "FINISHED") return true;
      if (status === "ERROR" || status === "EXPIRED") throw new Error(`Container status: ${status}`);
      console.log(`  ⏳ Container: ${status} (${i + 1}/${maxRetries})`);
    } catch (e) {
      if (e.message.includes("Container status:")) throw e;
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

module.exports = { publishCarouselToInstagram };
