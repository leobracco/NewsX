require("dotenv").config();
const axios = require("axios");
const fs    = require("fs");
const FormData = require("form-data");
const log = require("../logger");

const GRAPH_URL  = "https://graph.facebook.com/v21.0";
const PAGE_ID    = process.env.FACEBOOK_PAGE_ID;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

// ─── PUBLICAR CARRUSEL EN FACEBOOK ───────────────────────────────────
async function publishCarouselToFacebook(newsItem, imagePaths) {
  if (!PAGE_ID || !PAGE_TOKEN) {
    log.warn("Facebook: credenciales no configuradas, saltando");
    return null;
  }

  try {
    const { generated } = newsItem;
    const fbPost = generated.facebook;

    // 1. Subir cada imagen sin publicar
    log.info(`  FB: subiendo ${imagePaths.length} imagenes...`);
    const photoIds = [];

    for (const imgPath of imagePaths) {
      const photoId = await uploadPhotoUnpublished(imgPath);
      if (photoId) photoIds.push(photoId);
    }

    if (!photoIds.length) throw new Error("No se pudieron subir imagenes");

    // 2. Crear post con todas las fotos
    const postBody = {
      message:     fbPost.post,
      attached_media: photoIds.map(id => ({ media_fbid: id })),
      access_token: PAGE_TOKEN,
    };

    const res = await axios.post(`${GRAPH_URL}/${PAGE_ID}/feed`, postBody);

    log.info(`  FB: publicado [${res.data.id}]`);
    return { platform: "facebook", postId: res.data.id, url: `https://facebook.com/${res.data.id}` };

  } catch (e) {
    log.error(`  FB error: ${e.response?.data?.error?.message || e.message}`);
    return null;
  }
}

// ─── PUBLICAR STORY EN FACEBOOK ─────────────────────────────────────
async function publishStoryToFacebook(newsItem, storyImagePath) {
  if (!PAGE_ID || !PAGE_TOKEN) {
    log.warn("FB Story: credenciales no configuradas, saltando");
    return null;
  }

  try {
    // 1. Subir la imagen sin publicar
    log.info("  FB Story: subiendo imagen...");
    const photoId = await uploadPhotoUnpublished(storyImagePath);
    if (!photoId) throw new Error("No se pudo subir imagen para story");

    // 2. Publicar como story de la pagina
    const res = await axios.post(`${GRAPH_URL}/${PAGE_ID}/photo_stories`, {
      photo_id: photoId,
      access_token: PAGE_TOKEN,
    });

    log.info(`  FB Story: publicado [${res.data.post_id || res.data.id}]`);
    return {
      platform: "facebook_story",
      postId: res.data.post_id || res.data.id,
    };
  } catch (e) {
    log.error(`  FB Story error: ${e.response?.data?.error?.message || e.message}`);
    return null;
  }
}

async function uploadPhotoUnpublished(imagePath) {
  try {
    const form = new FormData();
    form.append("source",       fs.createReadStream(imagePath));
    form.append("published",    "false");
    form.append("access_token", PAGE_TOKEN);

    const res = await axios.post(`${GRAPH_URL}/${PAGE_ID}/photos`, form, {
      headers: form.getHeaders(),
    });
    return res.data.id;
  } catch (e) {
    log.error(`  Error subiendo foto: ${e.response?.data?.error?.message || e.message}`);
    return null;
  }
}

module.exports = { publishCarouselToFacebook, publishStoryToFacebook };
