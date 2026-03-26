require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function filterAndRankNews(articles) {
  if (!articles.length) return [];

  const summary = articles.slice(0, 20)
    .map((a, i) => `[${i}] TÍTULO: ${a.title} | DESC: ${a.description}`)
    .join("\n");

  const res = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Experto en agricultura argentina. Seleccioná las 3 noticias más relevantes para productores, agrónomos e inversores del campo argentino.
Criterios: tecnología agro, soja/maíz/trigo/ganadería, maquinaria, precision farming, commodities, biotecnología, sostenibilidad.

NOTICIAS:
${summary}

Respondé SOLO con JSON: {"selected": [0, 2, 5]}`,
    }],
  });

  try {
    const parsed = JSON.parse(res.content[0].text.replace(/```json|```/g, "").trim());
    return (parsed.selected || []).map(i => articles[i]).filter(Boolean);
  } catch {
    return articles.slice(0, 3);
  }
}

async function generateContent(article) {
  const res = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 3000,
    messages: [{
      role: "user",
      content: `Sos el community manager de "Agro Parallel" (@agro.parallel), medio digital de noticias agro argentino.
Adaptá esta noticia internacional para el campo argentino.

NOTICIA:
Título: ${article.title}
Descripción: ${article.description}
Fuente: ${article.source?.name || "Internacional"}
URL: ${article.url}

Respondé SOLO con JSON válido:
{
  "web": {
    "title": "Título en español max 80 chars",
    "summary": "Resumen 150-200 palabras adaptado al contexto argentino",
    "tags": ["tag1","tag2","tag3","tag4","tag5"],
    "category": "Tecnología|Mercados|Ganadería|Cultivos|Maquinaria|Sostenibilidad"
  },
  "carousel": {
    "title": "Título impactante max 55 chars",
    "category": "Tecnología|Mercados|Ganadería|Cultivos|Maquinaria|Sostenibilidad",
    "points": [
      { "headline": "Punto clave max 45 chars", "description": "Explicación útil para el productor argentino max 110 chars" }
    ]
  },
  "instagram": {
    "caption": "Post 100-150 palabras, empieza con emoji, contexto argentino, CTA al final",
    "hashtags": "#agro #agricultura #campo #argentina #agtech #agroparallel #campoargentino"
  },
  "facebook": {
    "post": "Post 200-250 palabras informativo, cerrá con pregunta para interacción",
    "link_title": "Título preview max 60 chars",
    "link_description": "Descripción preview max 100 chars"
  }
}

IMPORTANTE: carousel.points entre 2 y 5 según riqueza de la noticia.`,
    }],
  });

  try {
    const clean = res.content[0].text.replace(/```json|```/g, "").trim();
    return { original: article, generated: JSON.parse(clean), processedAt: new Date().toISOString() };
  } catch (e) {
    console.error("Error generando contenido:", article.title);
    return null;
  }
}

async function processNewsWithAI(articles) {
  console.log("🤖 Filtrando con IA...");
  const selected = await filterAndRankNews(articles);
  console.log(`📰 ${selected.length} noticias seleccionadas`);

  const processed = [];
  for (const article of selected) {
    console.log(`✍️  Procesando: ${article.title}`);
    const content = await generateContent(article);
    if (content) processed.push(content);
    await new Promise(r => setTimeout(r, 1000));
  }
  return processed;
}

module.exports = { processNewsWithAI };
