const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const {
  ROOT_DIR,
  UPLOAD_DIR,
  PROCESSED_DIR,
  TEMP_DIR,
  PRODUCT_UPLOAD_DIR,
  PRODUCT_PROCESSED_DIR
} = require("../utils/config");

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(UPLOAD_DIR, { recursive: true }),
    fs.mkdir(PROCESSED_DIR, { recursive: true }),
    fs.mkdir(TEMP_DIR, { recursive: true }),
    fs.mkdir(PRODUCT_UPLOAD_DIR, { recursive: true }),
    fs.mkdir(PRODUCT_PROCESSED_DIR, { recursive: true })
  ]);
}

function createBatchId() {
  return crypto.randomUUID();
}

function sanitizeBaseName(fileName) {
  const base = path.parse(fileName).name || "image";

  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "image";
}

function sanitizeIdentifier(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function buildStoredName(baseName, extension) {
  return `${Date.now()}-${crypto.randomUUID()}-${baseName}.${extension}`;
}

function buildProductOriginalName(extension) {
  return `original.${extension}`;
}

function buildProductVariantName({ productSlug, imageId, role, variantKey, extension }) {
  const safeRole = sanitizeIdentifier(role || "gallery");
  return `${productSlug}-${imageId}-${safeRole}-${variantKey}.${extension}`;
}

function buildDynamicVariantName({ variantKey, cacheKey, extension }) {
  return `${variantKey}-${cacheKey}.${extension}`;
}

function resolveSafeFilePath(baseDir, fileName) {
  const resolvedPath = path.resolve(baseDir, fileName);
  const normalizedBaseDir = path.resolve(baseDir);

  if (
    resolvedPath !== normalizedBaseDir &&
    !resolvedPath.startsWith(`${normalizedBaseDir}${path.sep}`)
  ) {
    return null;
  }

  return resolvedPath;
}

async function ensureDir(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toRelativePath(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

function resolveFromRoot(relativePath) {
  return path.resolve(ROOT_DIR, relativePath);
}

async function removeFile(filePath) {
  if (!filePath) {
    return;
  }

  await fs.unlink(filePath).catch(() => undefined);
}

module.exports = {
  ensureDirectories,
  createBatchId,
  sanitizeBaseName,
  sanitizeIdentifier,
  buildStoredName,
  buildProductOriginalName,
  buildProductVariantName,
  buildDynamicVariantName,
  resolveSafeFilePath,
  ensureDir,
  fileExists,
  readJson,
  writeJson,
  toRelativePath,
  resolveFromRoot,
  removeFile
};
