require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");
const log = require("./logger");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function filterAndRankNews(articles) {
  if (!articles.length) return [];

  const summary = articles
    .slice(0, 20)
    .map((a, i) => `[${i}] TITULO: ${a.title} | DESC: ${a.description}`)
    .join("\n");

  try {
    const res = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Experto en agricultura argentina. Selecciona las 3 noticias mas relevantes para productores, agronomos e inversores del campo argentino.
Criterios: tecnologia agro, soja/maiz/trigo/ganaderia, maquinaria, precision farming, commodities, biotecnologia, sostenibilidad.

NOTICIAS:
${summary}

Responde SOLO con JSON: {"selected": [0, 2, 5]}`,
        },
      ],
    });

    const parsed = JSON.parse(
      res.content[0].text.replace(/```json|```/g, "").trim(),
    );
    const selected = (parsed.selected || []).map((i) => articles[i]).filter(Boolean);
    log.info(`IA selecciono ${selected.length} noticias`);
    return selected;
  } catch (e) {
    log.warn(`Filtrado IA fallo (${e.message}), usando las primeras 3`);
    return articles.slice(0, 3);
  }
}

async function generateContent(article) {
  try {
    const res = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: `Sos el community manager de "Agro Parallel" (@agro.parallel), medio digital de noticias agro argentino.
Adapta esta noticia internacional para el campo argentino.

NOTICIA:
Titulo: ${article.title}
Descripcion: ${article.description}
Fuente: ${article.source?.name || "Internacional"}
URL: ${article.url}

Responde SOLO con JSON valido:
{
  "web": {
    "title": "Titulo en espanol max 80 chars",
    "summary": "Resumen 150-200 palabras adaptado al contexto argentino",
    "tags": ["tag1","tag2","tag3","tag4","tag5"],
    "category": "Tecnología|Mercados|Ganadería|Cultivos|Maquinaria|Sostenibilidad"
  },
  "carousel": {
    "title": "Titulo impactante max 55 chars",
    "category": "Tecnología|Mercados|Ganadería|Cultivos|Maquinaria|Sostenibilidad",
    "points": [
      { "headline": "Punto clave max 45 chars", "description": "Explicacion util para el productor argentino max 110 chars" }
    ]
  },
  "instagram": {
    "caption": "Post 100-150 palabras, empieza con emoji, contexto argentino, CTA al final",
    "hashtags": "#agro #agricultura #campo #argentina #agtech #agroparallel #campoargentino"
  },
  "facebook": {
    "post": "Post 200-250 palabras informativo, cerra con pregunta para interaccion",
    "link_title": "Titulo preview max 60 chars",
    "link_description": "Descripcion preview max 100 chars"
  }
}

IMPORTANTE: carousel.points entre 2 y 5 segun riqueza de la noticia.`,
        },
      ],
    });

    const clean = res.content[0].text.replace(/```json|```/g, "").trim();
    const generated = JSON.parse(clean);

    // Validar estructura minima
    if (!generated.web?.title || !generated.web?.summary) {
      log.warn(`Contenido generado incompleto para: ${article.title}`);
      return null;
    }

    return {
      original: article,
      generated,
      processedAt: new Date().toISOString(),
    };
  } catch (e) {
    log.error(`Error generando contenido para "${article.title}": ${e.message}`);
    return null;
  }
}

async function processNewsWithAI(articles) {
  log.info("Filtrando con IA...");

  if (!process.env.ANTHROPIC_API_KEY) {
    log.error("ANTHROPIC_API_KEY no configurada");
    return [];
  }

  const selected = await filterAndRankNews(articles);
  log.info(`${selected.length} noticias seleccionadas`);

  const processed = [];
  for (const article of selected) {
    log.info(`Generando contenido: ${article.title?.substring(0, 60)}`);
    const content = await generateContent(article);
    if (content) processed.push(content);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return processed;
}

module.exports = { processNewsWithAI };
