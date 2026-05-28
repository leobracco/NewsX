'use strict';
/* ══════════════════════════════════════════════════════════════════════
   NewsX — Listener del feed _changes de CouchDB.

   Hace dos cosas:

   1) Mira el `_changes` continuo: cuando un doc del CRM aparece con
      `publishRequest.processed === false`, lo procesa: regenera el
      carrusel si corresponde y publica en cada red pedida (facebook,
      instagram). Escribe `publishResult` y cambia el `estado`.

   2) Cada 60 s revisa docs con `estado === 'programado'` y
      `scheduledAt <= now` → los marca como `publicando` y los pasa
      por el flujo de publicación inmediata (sin redes — sólo
      “publicado” en la web). Si el doc además tiene `publishRequest`
      pendiente, también dispara la publicación a redes.

   3) Cada 10 min reintenta `publishRequest` no procesados con
      `attempts < 3`.

   Decisión de diseño: este worker NO expone HTTP — todo va por CouchDB.
   El CRM nunca necesita saber el host/puerto de NewsX (vienen juntos
   en el droplet pero podrían estar en hosts distintos).
═══════════════════════════════════════════════════════════════════════ */
require('dotenv').config();
const axios = require('axios');
const path  = require('path');
const log   = require('./logger');

const { generateAllFormats } = require('./carouselGenerator');
const { publishCarouselToFacebook }  = require('./publishers/facebookPublisher');
const { publishCarouselToInstagram } = require('./publishers/instagramPublisher');

const COUCH_URL  = process.env.COUCHDB_URL      || 'http://localhost:5984';
const COUCH_USER = process.env.COUCHDB_USER     || 'admin';
const COUCH_PASS = process.env.COUCHDB_PASSWORD || 'password';
const DB_NAME    = process.env.COUCHDB_DB       || 'news_agro_parallel';

const CAROUSEL_DIR = process.env.CAROUSEL_OUTPUT_DIR
  ? path.resolve(process.env.CAROUSEL_OUTPUT_DIR)
  : path.join(__dirname, '..', 'data', 'carousels');

const couch = axios.create({
  baseURL: COUCH_URL,
  auth: { username: COUCH_USER, password: COUCH_PASS },
  headers: { 'Content-Type': 'application/json' },
  // axios timeout = sin timeout para feed continuous
});

// Set de ids en proceso (lock in-memory; evita procesar 2 veces el
// mismo cambio si CouchDB nos lo emite repetido por nuestra propia
// escritura del resultado).
const inFlight = new Set();

/* ── Adapter: doc CouchDB → newsItem que esperan los publishers ── */
function docToNewsItem(doc) {
  const id = doc.botItemId || doc._id;

  // Caso A: doc generado por el pipeline (web/carousel/instagram/facebook ya están)
  if (doc.web && doc.carousel) {
    return {
      id,
      generated: {
        web:       doc.web,
        carousel:  doc.carousel,
        instagram: doc.instagram || { caption: doc.web.title || '', hashtags: '' },
        facebook:  doc.facebook  || { caption: doc.web.title || '' },
      },
      original: (doc.source && typeof doc.source === 'object')
        ? { source: doc.source, url: doc.source.url, title: doc.web.title }
        : { source: { name: doc.fuente || 'Agro Parallel' }, url: doc.url || '', title: doc.web.title },
      carouselImages: doc.carouselImages || {},
    };
  }

  // Caso B: doc manual cargado desde el CRM (titulo/resumen/rrssTexto/etc.)
  const title    = doc.titulo || 'Sin título';
  const summary  = doc.resumen || '';
  const baseTxt  = doc.rrssTexto || `${title}\n\n${summary}`;
  const tagsLine = doc.rrssHashtags || (doc.tags || []).map(t => `#${String(t).replace(/\s+/g,'')}`).join(' ');
  const caption  = tagsLine ? `${baseTxt}\n\n${tagsLine}` : baseTxt;

  return {
    id,
    generated: {
      web:       { title, summary, category: 'Noticia', tags: doc.tags || [] },
      carousel:  {
        title,
        category: 'Noticia',
        points: summary ? [{ title: 'Resumen', text: summary }] : [],
      },
      instagram: { caption, hashtags: doc.rrssHashtags || '' },
      facebook:  { caption },
    },
    original: {
      source: { name: doc.fuente || 'Agro Parallel' },
      url:    doc.url || '',
      title,
    },
    carouselImages: doc.carouselImages || {},
  };
}

/* ── Update con reintento por 409 (mid-air collision) ────────────── */
async function updateDoc(docId, patch) {
  for (let i = 0; i < 4; i++) {
    let current;
    try {
      const res = await couch.get(`/${DB_NAME}/${encodeURIComponent(docId)}`);
      current = res.data;
    } catch (e) {
      log.error(`updateDoc: get ${docId} → ${e.message}`);
      return null;
    }
    const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
    try {
      const r = await couch.put(`/${DB_NAME}/${encodeURIComponent(docId)}`, updated);
      return { ...updated, _rev: r.data.rev };
    } catch (e) {
      if (e.response?.status === 409) { await sleep(150 + 200*i); continue; }
      log.error(`updateDoc: put ${docId} → ${e.response?.data?.reason || e.message}`);
      return null;
    }
  }
  log.error(`updateDoc: 409 persistente en ${docId}`);
  return null;
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* ── Núcleo: procesar una publicación pedida desde el CRM ───────── */
async function procesarPublicacion(doc) {
  const id = doc._id;
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    log.info(`[changes] procesando publicación de ${id} (${(doc.publishRequest?.redes||[]).join(',')})`);

    // Marca que arrancamos (incrementa attempts) — útil para el cron de retries
    await updateDoc(id, {
      publishRequest: {
        ...doc.publishRequest,
        attempts: (doc.publishRequest.attempts || 0) + 1,
        startedAt: new Date().toISOString(),
      },
    });

    const item = docToNewsItem(doc);
    const redes = doc.publishRequest.redes || [];

    // ── Carrusel ────────────────────────────────────────────────
    const needsRegen = doc.publishRequest.regenerarCarrusel || !item.carouselImages || !item.carouselImages.vertical?.length;
    if (needsRegen) {
      if (!item.generated.carousel || !item.generated.carousel.title) {
        return await finalizar(id, null, 'error', { error: 'Sin datos de carrusel (faltan título/contenido para generar slides)' });
      }
      try {
        log.info(`[changes] generando carrusel para ${id}…`);
        item.carouselImages = await generateAllFormats(item, CAROUSEL_DIR);
        // Persistir las paths del carrusel en el doc
        await updateDoc(id, { carouselImages: item.carouselImages });
      } catch (e) {
        log.error(`[changes] generateAllFormats falló para ${id}: ${e.message}`);
        return await finalizar(id, null, 'error', { error: `Carrusel: ${e.message}` });
      }
    }

    const result = doc.publishResult || {};

    // ── Facebook ───────────────────────────────────────────────
    if (redes.includes('facebook')) {
      try {
        const imgs = item.carouselImages.square || item.carouselImages.vertical || [];
        if (!imgs.length) throw new Error('Sin imágenes square/vertical');
        const fb = await publishCarouselToFacebook(item, imgs);
        if (fb) result.facebook = { ok: true, mediaId: fb.postId || fb.mediaId || '', url: fb.url || '', ts: new Date().toISOString() };
        else    result.facebook = { ok: false, error: 'FB sin respuesta (¿credenciales?)', ts: new Date().toISOString() };
      } catch (e) {
        result.facebook = { ok: false, error: e.message, ts: new Date().toISOString() };
      }
    }

    // ── Instagram ──────────────────────────────────────────────
    if (redes.includes('instagram')) {
      try {
        const imgs = item.carouselImages.vertical || item.carouselImages.square || [];
        if (!imgs.length) throw new Error('Sin imágenes vertical/square');
        const ig = await publishCarouselToInstagram(item, imgs, item.carouselImages.vertical?.length ? 'vertical' : 'square');
        if (ig) result.instagram = { ok: true, mediaId: ig.mediaId || '', url: ig.url || '', ts: new Date().toISOString() };
        else    result.instagram = { ok: false, error: 'IG sin respuesta (¿credenciales / HTTPS?)', ts: new Date().toISOString() };
      } catch (e) {
        result.instagram = { ok: false, error: e.message, ts: new Date().toISOString() };
      }
    }

    // ── TikTok: reservado para el futuro ───────────────────────
    if (redes.includes('tiktok')) {
      result.tiktok = { ok: false, error: 'TikTok aún no implementado (esperar app approval)', ts: new Date().toISOString() };
    }

    // ── Resolver estado final ──────────────────────────────────
    const pedidas = redes.filter(r => r !== 'tiktok'); // tiktok no se cuenta para éxito
    const todasOk = pedidas.length > 0 && pedidas.every(r => result[r]?.ok);
    const algunaError = pedidas.some(r => result[r] && !result[r].ok);

    if (todasOk) {
      await finalizar(id, result, 'publicado', null);
    } else if (algunaError && (doc.publishRequest.attempts || 0) + 1 >= 3) {
      // Tres intentos: damos por error
      await finalizar(id, result, 'error', null);
    } else if (algunaError) {
      // Aún quedan reintentos: dejar processed:false para que el cron lo levante
      await updateDoc(id, {
        publishResult: result,
        publishRequest: { ...doc.publishRequest, attempts: (doc.publishRequest.attempts || 0) + 1, processed: false },
      });
      log.warn(`[changes] ${id}: error parcial, dejando para reintento`);
    } else {
      // Nada fallo pero nada se publicó tampoco (¿redes inválidas?)
      await finalizar(id, result, 'publicado', null);
    }
  } finally {
    inFlight.delete(id);
  }
}

async function finalizar(docId, result, estado, extraErr) {
  const patch = {
    estado,
    publishResult: result || (extraErr ? { error: extraErr.error } : {}),
    publishRequest: undefined, // se reemplaza abajo
  };
  // Hacemos getDoc otra vez para preservar attempts:
  const get = await couch.get(`/${DB_NAME}/${encodeURIComponent(docId)}`).catch(()=>null);
  const cur = get?.data || {};
  patch.publishRequest = {
    ...(cur.publishRequest || {}),
    processed: true,
    finishedAt: new Date().toISOString(),
  };
  if (estado === 'publicado' && !cur.publishedAt) patch.publishedAt = new Date().toISOString();
  await updateDoc(docId, patch);
  log.info(`[changes] ${docId} → ${estado}`);
}

/* ── Feed _changes continuo ─────────────────────────────────────── */
async function watchChanges() {
  // since=now para no replay del histórico al arrancar
  log.info(`[changes] conectando a ${COUCH_URL}/${DB_NAME}/_changes …`);
  while (true) {
    try {
      const res = await couch.get(`/${DB_NAME}/_changes`, {
        params: {
          feed: 'continuous',
          since: 'now',
          include_docs: true,
          heartbeat: 30000,
        },
        responseType: 'stream',
        timeout: 0,
      });
      let buf = '';
      await new Promise((resolve, reject) => {
        res.data.on('data', chunk => {
          buf += chunk.toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let evt; try { evt = JSON.parse(line); } catch { continue; }
            const doc = evt.doc;
            if (!doc || doc.type !== 'news') continue;
            if (!doc.publishRequest || doc.publishRequest.processed) continue;
            // Lanzamos asincrónico, no bloquea el stream
            procesarPublicacion(doc).catch(e => log.error(`[changes] procesar falló: ${e.message}`));
          }
        });
        res.data.on('end', () => resolve('end'));
        res.data.on('error', err => reject(err));
      });
    } catch (e) {
      log.error(`[changes] feed cayó: ${e.message} — reintentando en 5 s`);
      await sleep(5000);
    }
  }
}

/* ── Tick cada 60 s para scheduledAt ────────────────────────────── */
async function tickProgramadas() {
  try {
    const res = await couch.post(`/${DB_NAME}/_find`, {
      selector: { type: 'news', estado: 'programado' },
      limit: 100,
    });
    const now = Date.now();
    for (const doc of res.data.docs) {
      const sch = doc.scheduledAt ? new Date(doc.scheduledAt).getTime() : 0;
      if (!sch || sch > now) continue;
      log.info(`[scheduler] llegó la hora de ${doc._id}`);
      await updateDoc(doc._id, {
        estado: 'publicado',
        publishedAt: new Date().toISOString(),
      });
      // Si además tiene publishRequest pendiente, se dispara solo por _changes.
    }
  } catch (e) {
    log.error(`[scheduler] tick falló: ${e.message}`);
  }
}

/* ── Tick cada 10 min para reintentar publishRequest fallidos ───── */
async function tickReintentos() {
  try {
    const res = await couch.post(`/${DB_NAME}/_find`, {
      selector: {
        type: 'news',
        'publishRequest.processed': false,
        estado: { '$in': ['publicando', 'error'] },
      },
      limit: 50,
    });
    for (const doc of res.data.docs) {
      if ((doc.publishRequest?.attempts || 0) >= 3) continue;
      log.info(`[retry] reintentando ${doc._id} (intento ${(doc.publishRequest.attempts||0)+1})`);
      procesarPublicacion(doc).catch(e => log.error(`[retry] ${doc._id}: ${e.message}`));
    }
  } catch (e) {
    // _find puede tirar 400 si no hay índice; lo logueamos y seguimos.
    log.warn(`[retry] tick falló (puede que falte índice): ${e.message}`);
  }
}

/* ── Entry point ────────────────────────────────────────────────── */
async function main() {
  log.info('NewsX changes-listener iniciado');
  log.info(`DB: ${DB_NAME}  COUCH: ${COUCH_URL}`);

  // Cada 60 s: scheduledAt
  setInterval(() => tickProgramadas().catch(()=>{}), 60 * 1000);
  // Cada 10 min: retries
  setInterval(() => tickReintentos().catch(()=>{}), 10 * 60 * 1000);
  // Una vez al arrancar (por si quedó algo a medias)
  setTimeout(() => tickReintentos().catch(()=>{}), 5000);

  await watchChanges();
}

if (require.main === module) {
  main().catch(e => { log.error(`fatal: ${e.message}`); process.exit(1); });
}

module.exports = { procesarPublicacion, docToNewsItem };
