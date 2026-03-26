const fs = require("fs").promises;
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const QUEUE_FILE = path.join(DATA_DIR, "publish_queue.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadQueue() {
  try {
    return JSON.parse(await fs.readFile(QUEUE_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function saveToQueue(items) {
  await ensureDir();
  const queue = await loadQueue();
  const newItems = items.map((item) => ({
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...item,
    status: "pending",
    publishedTo: [],
    createdAt: new Date().toISOString(),
  }));
  await fs.writeFile(
    QUEUE_FILE,
    JSON.stringify([...queue, ...newItems], null, 2),
  );
  console.log(`💾 ${newItems.length} items guardados en cola`);
  return newItems;
}

async function getPendingItems() {
  return (await loadQueue()).filter((i) => i.status === "pending");
}

async function markAsPublished(id, platform) {
  const queue = await loadQueue();
  const item = queue.find((i) => i.id === id);
  if (item) {
    item.publishedTo.push(platform);
    if (
      ["web", "instagram", "facebook"].every((p) =>
        item.publishedTo.includes(p),
      )
    ) {
      item.status = "published";
      item.publishedAt = new Date().toISOString();
    }
  }
  await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

async function markAsFailed(id, reason) {
  const queue = await loadQueue();
  const item = queue.find((i) => i.id === id);
  if (item) {
    item.status = "failed";
    item.failReason = reason;
    item.failedAt = new Date().toISOString();
  }
  await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

async function getDailyReport() {
  const today = new Date().toISOString().split("T")[0];
  const items = (await loadQueue()).filter((i) =>
    i.createdAt?.startsWith(today),
  );
  return {
    date: today,
    total: items.length,
    published: items.filter((i) => i.status === "published").length,
    pending: items.filter((i) => i.status === "pending").length,
    failed: items.filter((i) => i.status === "failed").length,
  };
}

async function getPublishedUrls() {
  const queue = await loadQueue();
  return new Set(
    queue.filter((i) => i.status === "published").map((i) => i.original.url),
  );
}

module.exports = {
  saveToQueue,
  loadQueue,
  getPendingItems,
  markAsPublished,
  markAsFailed,
  getDailyReport,
  getPublishedUrls,
};
