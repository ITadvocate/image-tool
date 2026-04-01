const path = require("path");

const { PRODUCT_UPLOAD_DIR } = require("../utils/config");
const {
  ensureDir,
  readJson,
  writeJson,
  sanitizeIdentifier
} = require("./fileService");

function getProductDirectory(productId) {
  const productSlug = sanitizeIdentifier(productId);
  const productDir = path.join(PRODUCT_UPLOAD_DIR, productSlug);

  return {
    productSlug,
    productDir,
    manifestPath: path.join(productDir, "manifest.json")
  };
}

function createEmptyManifest({ productId, metadata = {} }) {
  const { productSlug } = getProductDirectory(productId);

  return {
    productId,
    productSlug,
    metadata,
    images: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function getProductManifest(productId) {
  const { manifestPath } = getProductDirectory(productId);
  return readJson(manifestPath, null);
}

async function loadProductManifest(productId, metadata = {}) {
  const { productDir, manifestPath } = getProductDirectory(productId);
  await ensureDir(productDir);

  const existing = await readJson(manifestPath, null);

  if (!existing) {
    return createEmptyManifest({ productId, metadata });
  }

  return {
    ...existing,
    metadata: {
      ...(existing.metadata || {}),
      ...metadata
    }
  };
}

async function saveProductManifest(manifest) {
  const { manifestPath } = getProductDirectory(manifest.productId);

  const nextManifest = {
    ...manifest,
    updatedAt: new Date().toISOString()
  };

  await writeJson(manifestPath, nextManifest);
  return nextManifest;
}

async function upsertProductImages({ productId, metadata, images }) {
  const manifest = await loadProductManifest(productId, metadata);
  const imageMap = new Map(manifest.images.map((image) => [image.imageId, image]));

  for (const image of images) {
    imageMap.set(image.imageId, image);
  }

  manifest.images = Array.from(imageMap.values());
  manifest.metadata = {
    ...(manifest.metadata || {}),
    ...metadata
  };

  return saveProductManifest(manifest);
}

async function updateProductImage(productId, imageId, updater) {
  const manifest = await loadProductManifest(productId);
  const imageIndex = manifest.images.findIndex((image) => image.imageId === imageId);

  if (imageIndex === -1) {
    return null;
  }

  const current = manifest.images[imageIndex];
  manifest.images[imageIndex] = {
    ...current,
    ...updater(current),
    updatedAt: new Date().toISOString()
  };

  const saved = await saveProductManifest(manifest);
  return saved.images[imageIndex];
}

async function getProductImage(productId, imageId) {
  const manifest = await getProductManifest(productId);

  if (!manifest) {
    return null;
  }

  return manifest.images.find((image) => image.imageId === imageId) || null;
}

module.exports = {
  getProductDirectory,
  getProductManifest,
  loadProductManifest,
  saveProductManifest,
  upsertProductImages,
  updateProductImage,
  getProductImage
};
