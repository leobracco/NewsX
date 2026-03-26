require("dotenv").config();
const axios = require("axios");
const fs    = require("fs");
const FormData = require("form-data");

const GRAPH_URL  = "https://graph.facebook.com/v19.0";
const PAGE_ID    = process.env.FACEBOOK_PAGE_ID;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

// ─── PUBLICAR CARRUSEL EN FACEBOOK ───────────────────────────────────
/**
 * Publica un carrusel en Facebook como álbum de fotos con texto
 * Facebook no soporta carrusel nativo vía API para páginas,
 * se publican como fotos múltiples en un post.
 */
async function publishCarouselToFacebook(newsItem, imagePaths) {
  if (!PAGE_ID || !PAGE_TOKEN) {
    console.log("  ⚠️  Facebook: credenciales no configuradas, saltando");
    return null;
  }

  try {
    const { generated } = newsItem;
    const fbPost = generated.facebook;

    // 1. Subir cada imagen y obtener photo_id (sin publicar)
    console.log(`  📤 Facebook: subiendo ${imagePaths.length} imágenes...`);
    const photoIds = [];

    for (const imgPath of imagePaths) {
      const photoId = await uploadPhotoUnpublished(imgPath);
      if (photoId) photoIds.push(photoId);
    }

    if (!photoIds.length) throw new Error("No se pudieron subir imágenes");

    // 2. Crear post con todas las fotos adjuntas
    const postBody = {
      message:     fbPost.post,
      attached_media: photoIds.map(id => ({ media_fbid: id })),
      access_token: PAGE_TOKEN,
    };

    const res = await axios.post(`${GRAPH_URL}/${PAGE_ID}/feed`, postBody);

    console.log(`  ✅ Facebook: publicado [${res.data.id}]`);
    return { platform: "facebook", postId: res.data.id, url: `https://facebook.com/${res.data.id}` };

  } catch (e) {
    console.error("  ❌ Facebook error:", e.response?.data?.error?.message || e.message);
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
    console.error("  ❌ Error subiendo foto:", e.response?.data?.error?.message || e.message);
    return null;
  }
}

// ─── PUBLICAR POST SIMPLE (sin carrusel) ─────────────────────────────
async function publishPostToFacebook(newsItem, imageUrl = null) {
  if (!PAGE_ID || !PAGE_TOKEN) return null;

  try {
    const { generated, original } = newsItem;
    const body = {
      message:      generated.facebook.post,
      link:         original.url,
      access_token: PAGE_TOKEN,
    };

    if (imageUrl) body.picture = imageUrl;

    const res = await axios.post(`${GRAPH_URL}/${PAGE_ID}/feed`, body);
    console.log(`  ✅ Facebook post simple: [${res.data.id}]`);
    return { platform: "facebook", postId: res.data.id };
  } catch (e) {
    console.error("  ❌ Facebook error:", e.response?.data?.error?.message || e.message);
    return null;
  }
}

module.exports = { publishCarouselToFacebook, publishPostToFacebook };
