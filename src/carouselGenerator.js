require("dotenv").config();
const { Canvas } = require("skia-canvas");
function createCanvas(w, h) { return new Canvas(w, h); }
const fs   = require("fs").promises;
const path = require("path");

// ─── MARCA ────────────────────────────────────────────────────────────
const BRAND = {
  name:      "AGRO PARALLEL",
  nameGreen: "PARALLEL",        // parte en verde
  instagram: "@agro.parallel",
  facebook:  "AgroParallel",
  web:       "www.agroparallel.com",
  cta:       "Seguinos en @agro.parallel para más novedades del campo 🌾",
  colors: {
    dark:    "#3D4257",
    green:   "#6DC231",
    black:   "#1A1C26",
    white:   "#FFFFFF",
    muted:   "#A0A8C0",
    darkest: "#12141E",
  },
};

// ─── FORMATOS ─────────────────────────────────────────────────────────
const FORMATS = {
  square:     { width: 1080, height: 1080 },
  vertical:   { width: 1080, height: 1350 },
  horizontal: { width: 1920, height: 1080 },
  story:      { width: 1080, height: 1920 },
};

// ─── HELPERS ──────────────────────────────────────────────────────────

function dotPattern(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = BRAND.colors.green;
  ctx.globalAlpha = 0.05;
  for (let x = 40; x < w; x += 40)
    for (let y = 40; y < h; y += 40) {
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    }
  ctx.restore();
}

function greenBar(ctx, h) {
  ctx.fillStyle = BRAND.colors.green;
  ctx.fillRect(0, 0, 12, h);
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, y);
      y += lineH; line = word + " ";
    } else { line = test; }
  }
  ctx.fillText(line.trim(), x, y);
  return y;
}

function wrapTextCenter(ctx, text, cx, y, maxW, lineH) {
  ctx.save(); ctx.textAlign = "center";
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), cx, y);
      y += lineH; line = word + " ";
    } else { line = test; }
  }
  ctx.fillText(line.trim(), cx, y);
  ctx.restore();
}

/** Dibuja "AGRO ▏PARALLEL" con PARALLEL en verde */
function drawBrandText(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${size}px Arial`;
  ctx.fillStyle = BRAND.colors.white;
  ctx.fillText("AGRO ", x, y);
  const agroW = ctx.measureText("AGRO ").width;
  ctx.fillStyle = BRAND.colors.green;
  ctx.fillText("PARALLEL", x + agroW, y);
  ctx.restore();
}

function drawSlideIndicators(ctx, w, h, current, total) {
  const dotR   = 6;
  const gap    = 20;
  const totalW = (total - 1) * gap + dotR * 2;
  const startX = w - totalW - 36;
  const y      = h - 32;
  for (let i = 0; i < total; i++) {
    ctx.save();
    ctx.fillStyle   = i === current ? BRAND.colors.green : BRAND.colors.muted;
    ctx.globalAlpha = i === current ? 1 : 0.35;
    ctx.beginPath();
    ctx.arc(startX + i * gap + dotR, y, i === current ? dotR + 2 : dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function pill(ctx, x, y, text, fs) {
  ctx.save();
  ctx.font = `800 ${fs}px Arial`;
  const tw = ctx.measureText(text).width;
  const ph = fs + 22; const pw = tw + 36;
  ctx.fillStyle = BRAND.colors.green;
  roundRect(ctx, x, y - ph * 0.72, pw, ph, 8); ctx.fill();
  ctx.fillStyle = BRAND.colors.black;
  ctx.fillText(text, x + 18, y + fs * 0.12);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── SLIDES ───────────────────────────────────────────────────────────

function drawSlideTitle(ctx, w, h, data, total) {
  // Fondo
  ctx.fillStyle = BRAND.colors.dark; ctx.fillRect(0, 0, w, h);
  dotPattern(ctx, w, h);
  greenBar(ctx, h);

  // Acento superior derecho
  ctx.save(); ctx.fillStyle = BRAND.colors.green; ctx.globalAlpha = 0.18;
  ctx.fillRect(w - 280, 0, 280, 8); ctx.restore();

  // Categoría pill
  const catY = h * 0.19;
  const fs   = w > 1200 ? 30 : 26;
  pill(ctx, 80, catY, data.category.toUpperCase(), fs);

  // Título
  const titleFs = w > 1500 ? 76 : w > 1080 ? 68 : 62;
  ctx.font      = `900 ${titleFs}px Arial`;
  ctx.fillStyle = BRAND.colors.white;
  wrapText(ctx, data.title, 80, h * 0.36, w - 160, titleFs * 1.22);

  // Separador + fuente
  ctx.fillStyle = BRAND.colors.green;
  ctx.fillRect(80, h * 0.73, 100, 5);
  ctx.font      = `${28}px Arial`;
  ctx.fillStyle = BRAND.colors.muted;
  ctx.fillText(`Fuente: ${data.source}`, 80, h * 0.795);

  // Brand bottom-right
  drawBrandText(ctx, w - 340, h - 38, 28);

  drawSlideIndicators(ctx, w, h, 0, total);
}

function drawSlideDataPoint(ctx, w, h, data, idx, total) {
  const isEven = idx % 2 === 0;
  ctx.fillStyle = isEven ? BRAND.colors.black : BRAND.colors.dark;
  ctx.fillRect(0, 0, w, h);
  greenBar(ctx, h);

  // Número decorativo de fondo
  ctx.save();
  ctx.font        = `900 ${h * 0.55}px Arial`;
  ctx.fillStyle   = BRAND.colors.green;
  ctx.globalAlpha = 0.055;
  ctx.fillText(`0${idx}`, w * 0.42, h * 0.76);
  ctx.restore();

  // Número principal
  const numFs = w > 1500 ? 110 : 90;
  ctx.font      = `900 ${numFs}px Arial`;
  ctx.fillStyle = BRAND.colors.green;
  ctx.fillText(`0${idx}`, 80, h * 0.30);

  // Barra verde
  ctx.fillStyle = BRAND.colors.green;
  ctx.fillRect(80, h * 0.335, 80, 5);

  // Headline
  const hFs = w > 1500 ? 58 : 50;
  ctx.font      = `800 ${hFs}px Arial`;
  ctx.fillStyle = BRAND.colors.white;
  wrapText(ctx, data.headline, 80, h * 0.435, w - 160, hFs * 1.28);

  // Descripción
  const dFs = w > 1500 ? 34 : 30;
  ctx.font      = `${dFs}px Arial`;
  ctx.fillStyle = BRAND.colors.muted;
  wrapText(ctx, data.description, 80, h * 0.645, w - 160, dFs * 1.6);

  // Brand bottom-right
  drawBrandText(ctx, w - 300, h - 36, 24, 0.5);

  drawSlideIndicators(ctx, w, h, idx, total);
}

function drawSlideCTA(ctx, w, h, idx, total) {
  // Fondo degradado verde
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#4A8F1F");
  g.addColorStop(0.5, BRAND.colors.green);
  g.addColorStop(1, "#3D7A15");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // Patrón hexagonal sutil
  ctx.save();
  ctx.strokeStyle = BRAND.colors.black; ctx.lineWidth = 2; ctx.globalAlpha = 0.06;
  const s = 80;
  for (let x = 0; x < w + s; x += s * 1.5)
    for (let y = 0; y < h + s; y += s * 1.73) {
      hexPath(ctx, x, y, s); ctx.stroke();
      hexPath(ctx, x + s * 0.75, y + s * 0.865, s); ctx.stroke();
    }
  ctx.restore();

  // Barra izquierda oscura
  ctx.fillStyle = BRAND.colors.dark; ctx.fillRect(0, 0, 12, h);

  // Brand centrado grande
  const brandFs = w > 1200 ? 90 : 72;
  ctx.save();
  ctx.font      = `900 ${brandFs}px Arial`;
  ctx.textAlign = "center";
  ctx.fillStyle = BRAND.colors.dark;
  ctx.fillText("AGRO ", w / 2 - ctx.measureText("PARALLEL").width / 2, h * 0.42);
  ctx.restore();
  // Redibujamos centrado correctamente
  ctx.save();
  ctx.font      = `900 ${brandFs}px Arial`;
  const agroW   = ctx.measureText("AGRO ").width;
  const paralW  = ctx.measureText("PARALLEL").width;
  const totalBW = agroW + paralW;
  const startBX = (w - totalBW) / 2;
  ctx.fillStyle = BRAND.colors.dark;
  ctx.fillText("AGRO ", startBX, h * 0.42);
  ctx.fillStyle = BRAND.colors.black;
  ctx.globalAlpha = 0.6;
  ctx.fillText("PARALLEL", startBX + agroW, h * 0.42);
  ctx.restore();

  // CTA texto
  const ctaFs = w > 1500 ? 44 : 38;
  ctx.font      = `700 ${ctaFs}px Arial`;
  ctx.fillStyle = BRAND.colors.dark;
  wrapTextCenter(ctx, BRAND.cta, w / 2, h * 0.57, w - 180, ctaFs * 1.45);

  // Redes sociales
  ctx.save();
  ctx.font      = `${28}px Arial`;
  ctx.fillStyle = BRAND.colors.dark;
  ctx.globalAlpha = 0.7;
  ctx.textAlign = "center";
  ctx.fillText(`📸 ${BRAND.instagram}   |   👍 ${BRAND.facebook}   |   🌐 ${BRAND.web}`, w / 2, h * 0.86);
  ctx.restore();

  drawSlideIndicators(ctx, w, h, idx, total);
}

function drawSlideCredits(ctx, w, h, data, idx, total) {
  ctx.fillStyle = BRAND.colors.dark; ctx.fillRect(0, 0, w, h);
  dotPattern(ctx, w, h);
  greenBar(ctx, h);

  ctx.font      = `700 ${28}px Arial`;
  ctx.fillStyle = BRAND.colors.muted;
  ctx.fillText("FUENTE ORIGINAL", 80, h * 0.29);

  ctx.font      = `900 ${46}px Arial`;
  ctx.fillStyle = BRAND.colors.white;
  wrapText(ctx, data.sourceName, 80, h * 0.39, w - 160, 58);

  ctx.font      = `${26}px Arial`;
  ctx.fillStyle = BRAND.colors.green;
  wrapText(ctx, data.sourceUrl, 80, h * 0.52, w - 160, 36);

  ctx.fillStyle = BRAND.colors.green; ctx.globalAlpha = 0.3;
  ctx.fillRect(80, h * 0.64, w - 160, 2);
  ctx.globalAlpha = 1;

  ctx.font      = `italic ${26}px Arial`;
  ctx.fillStyle = BRAND.colors.muted;
  wrapText(ctx, "El contenido fue adaptado y curado por Agro Parallel para el campo argentino.", 80, h * 0.71, w - 160, 38);

  // Brand centrado abajo
  const bFs     = 32;
  ctx.font      = `900 ${bFs}px Arial`;
  const aW      = ctx.measureText("AGRO ").width;
  const pW      = ctx.measureText("PARALLEL").width;
  const bStartX = (w - aW - pW) / 2;
  ctx.fillStyle = BRAND.colors.white;
  ctx.fillText("AGRO ", bStartX, h - 44);
  ctx.fillStyle = BRAND.colors.green;
  ctx.fillText("PARALLEL", bStartX + aW, h - 44);

  drawSlideIndicators(ctx, w, h, idx, total);
}

function hexPath(ctx, x, y, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a  = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + size * Math.cos(a);
    const py = y + size * Math.sin(a);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// ─── GENERADOR PRINCIPAL ──────────────────────────────────────────────

function buildSlides(carouselData, original) {
  const slides = [
    { type: "title", data: { title: carouselData.title, category: carouselData.category, source: original.source?.name || "Internacional" } },
    ...(carouselData.points || []).map((p, i) => ({ type: "datapoint", index: i + 1, data: p })),
    { type: "cta" },
    { type: "credits", data: { sourceName: original.source?.name || "Internacional", sourceUrl: original.url } },
  ];
  return slides;
}

async function generateCarousel(newsItem, formatKey = "square", outputDir) {
  const fmt = FORMATS[formatKey];
  if (!fmt) throw new Error(`Formato desconocido: ${formatKey}`);

  const { generated, original, id } = newsItem;
  const carouselData = generated?.carousel;
  if (!carouselData) throw new Error("Sin datos de carrusel. Ejecutar aiProcessor primero.");

  const itemDir = path.join(outputDir, id, formatKey);
  await fs.mkdir(itemDir, { recursive: true });

  const slides  = buildSlides(carouselData, original);
  const total   = slides.length;
  const paths   = [];

  for (let i = 0; i < slides.length; i++) {
    const slide  = slides[i];
    const canvas = createCanvas(fmt.width, fmt.height);
    const ctx    = canvas.getContext("2d");
    const num    = i + 1;

    console.log(`  🎨 Slide ${num}/${total} [${formatKey}]: ${slide.type}`);

    switch (slide.type) {
      case "title":     drawSlideTitle(ctx, fmt.width, fmt.height, slide.data, total); break;
      case "datapoint": drawSlideDataPoint(ctx, fmt.width, fmt.height, slide.data, slide.index, total); break;
      case "cta":       drawSlideCTA(ctx, fmt.width, fmt.height, num, total); break;
      case "credits":   drawSlideCredits(ctx, fmt.width, fmt.height, slide.data, num, total); break;
    }

    const filePath = path.join(itemDir, `slide_${String(num).padStart(2, "0")}.png`);
    await canvas.saveAs(filePath);
    paths.push(filePath);
  }

  console.log(`  ✅ ${paths.length} slides → ${itemDir}`);
  return paths;
}

async function generateAllFormats(newsItem, outputDir) {
  const results = {};
  for (const fmt of Object.keys(FORMATS)) {
    try { results[fmt] = await generateCarousel(newsItem, fmt, outputDir); }
    catch (e) { console.error(`  ❌ ${fmt}:`, e.message); results[fmt] = []; }
  }
  return results;
}

module.exports = { generateCarousel, generateAllFormats, FORMATS };
