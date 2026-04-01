const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const {
  PRODUCT_PROCESSED_DIR,
  DYNAMIC_CACHE_MAX_AGE_SECONDS
} = require("../utils/config");
const { AppError } = require("../utils/errors");
const { generateBaseAltText, generateVariantAltText } = require("../utils/altText");
const {
  ensureDir,
  fileExists,
  buildProductVariantName,
  buildDynamicVariantName,
  toRelativePath,
  resolveFromRoot,
  sanitizeIdentifier
} = require("./fileService");
const { updateProductImage } = require("./manifestService");

function buildVariantCacheKey({ variantKey, format, quality, watermark }) {
  const watermarkKey = watermark?.enabled
    ? `${watermark.position}-${watermark.opacity}-${watermark.text || "logo"}`
    : "plain";

  return `${variantKey}-${format}-q${quality}-${sanitizeIdentifier(watermarkKey)}`;
}

function buildResizeOptions(profile, customFit) {
  if (!profile.width && !profile.height) {
    return null;
  }

  return {
    width: profile.width,
    height: profile.height,
    fit: customFit || profile.fit || "inside",
    position: profile.position === "attention" ? sharp.strategy.attention : (profile.position || "centre"),
    withoutEnlargement: true
  };
}

async function createTextWatermark(width, height, watermarkText, position, opacity) {
  const xByPosition = {
    northwest: "6%",
    north: "50%",
    northeast: "94%",
    west: "6%",
    center: "50%",
    east: "94%",
    southwest: "6%",
    south: "50%",
    southeast: "94%"
  };
  const yByPosition = {
    northwest: "10%",
    north: "10%",
    northeast: "10%",
    west: "50%",
    center: "50%",
    east: "50%",
    southwest: "92%",
    south: "92%",
    southeast: "92%"
  };
  const anchorByPosition = {
    northwest: "start",
    north: "middle",
    northeast: "end",
    west: "start",
    center: "middle",
    east: "end",
    southwest: "start",
    south: "middle",
    southeast: "end"
  };

  const fontSize = Math.max(22, Math.round(width * 0.03));
  const safeText = String(watermarkText || "Brand")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .mark {
          fill: rgba(255,255,255,${opacity});
          font-size: ${fontSize}px;
          font-family: Arial, Helvetica, sans-serif;
          font-weight: 700;
          letter-spacing: 1px;
        }
      </style>
      <text
        x="${xByPosition[position] || xByPosition.southeast}"
        y="${yByPosition[position] || yByPosition.southeast}"
        text-anchor="${anchorByPosition[position] || anchorByPosition.southeast}"
        class="mark">${safeText}</text>
    </svg>`
  );
}

async function buildWatermarkOverlay(metadata, watermark) {
  const width = metadata.width || 1200;
  const height = metadata.height || 1200;

  if (watermark.logoPath && await fileExists(watermark.logoPath)) {
    const logoWidth = Math.max(80, Math.round(width * 0.18));
    return sharp(watermark.logoPath)
      .resize({ width: logoWidth, withoutEnlargement: true })
      .ensureAlpha(watermark.opacity)
      .png()
      .toBuffer();
  }

  return createTextWatermark(width, height, watermark.text, watermark.position, watermark.opacity);
}

async function buildBaseBuffer(sourcePath, profile, options) {
  let pipeline = sharp(sourcePath).rotate();
  const resizeOptions = buildResizeOptions(profile, options.fit);

  if (resizeOptions) {
    pipeline = pipeline.resize(resizeOptions);
  }

  if (!options.stripMetadata) {
    pipeline = pipeline.withMetadata();
  }

  return pipeline.toBuffer();
}

function applyOutputFormat(pipeline, format, quality) {
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality, mozjpeg: true });
    case "png":
      return pipeline.png({
        quality,
        compressionLevel: Math.max(0, Math.min(9, Math.round((100 - quality) / 10)))
      });
    case "webp":
      return pipeline.webp({ quality });
    case "avif":
      return pipeline.avif({ quality, effort: 4 });
    case "tiff":
      return pipeline.tiff({ quality, compression: quality >= 90 ? "lzw" : "jpeg" });
    default:
      return pipeline.jpeg({ quality, mozjpeg: true });
  }
}

async function writeDerivative({ sourcePath, outputPath, profile, format, quality, stripMetadata, watermark, fit }) {
  const baseBuffer = await buildBaseBuffer(sourcePath, profile, {
    stripMetadata,
    fit
  });
  const baseImage = sharp(baseBuffer);
  const metadata = await baseImage.metadata();
  let pipeline = sharp(baseBuffer);

  if (watermark?.enabled) {
    const overlay = await buildWatermarkOverlay(metadata, watermark);
    const composite = watermark.logoPath && await fileExists(watermark.logoPath)
      ? [{ input: overlay, gravity: watermark.position || "southeast" }]
      : [{ input: overlay }];

    pipeline = pipeline.composite(composite);
  }

  pipeline = applyOutputFormat(pipeline, format, quality);
  await ensureDir(path.dirname(outputPath));
  await pipeline.toFile(outputPath);

  const [outputMetadata, stats] = await Promise.all([sharp(outputPath).metadata(), fs.stat(outputPath)]);

  return {
    width: outputMetadata.width,
    height: outputMetadata.height,
    size: stats.size
  };
}

function buildVariantRecord({
  imageRecord,
  profile,
  format,
  quality,
  watermark,
  fileName,
  outputPath,
  dimensions
}) {
  const variantAltText = generateVariantAltText(imageRecord.altText, profile.key);

  return {
    key: profile.key,
    label: profile.label,
    category: profile.category,
    cacheKey: buildVariantCacheKey({
      variantKey: profile.key,
      format,
      quality,
      watermark
    }),
    fileName,
    relativePath: toRelativePath(outputPath),
    format,
    width: dimensions.width,
    height: dimensions.height,
    size: dimensions.size,
    altText: variantAltText,
    watermarkApplied: Boolean(watermark?.enabled),
    createdAt: new Date().toISOString()
  };
}

async function processProductImage({ product, imageRecord, profiles, format, quality, stripMetadata, watermark }) {
  const productSlug = sanitizeIdentifier(product.productId);
  const existingVariants = Array.isArray(imageRecord.variants) ? imageRecord.variants : [];
  const nextVariants = [...existingVariants];
  const imageDir = path.join(PRODUCT_PROCESSED_DIR, productSlug, imageRecord.imageId);

  for (const profile of profiles) {
    const cacheKey = buildVariantCacheKey({
      variantKey: profile.key,
      format,
      quality,
      watermark
    });
    const existingVariant = nextVariants.find((variant) => variant.cacheKey === cacheKey);

    if (existingVariant && await fileExists(resolveFromRoot(existingVariant.relativePath))) {
      continue;
    }

    const fileName = buildProductVariantName({
      productSlug,
      imageId: imageRecord.imageId,
      role: imageRecord.role,
      variantKey: profile.key,
      extension: format
    });
    const outputPath = path.join(imageDir, fileName);
    const dimensions = await writeDerivative({
      sourcePath: resolveFromRoot(imageRecord.source.relativePath),
      outputPath,
      profile,
      format,
      quality,
      stripMetadata,
      watermark
    });

    const variantRecord = buildVariantRecord({
      imageRecord,
      profile,
      format,
      quality,
      watermark,
      fileName,
      outputPath,
      dimensions
    });

    const replaceIndex = nextVariants.findIndex((variant) => variant.cacheKey === cacheKey);

    if (replaceIndex >= 0) {
      nextVariants[replaceIndex] = variantRecord;
    } else {
      nextVariants.push(variantRecord);
    }
  }

  return updateProductImage(product.productId, imageRecord.imageId, () => ({
    processing: {
      format,
      quality,
      stripMetadata,
      watermark
    },
    variants: nextVariants
  }));
}

function hashDynamicOptions(options) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(options))
    .digest("hex")
    .slice(0, 16);
}

async function serveVariantFile(res, filePath, { download = false, cacheControl } = {}) {
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }

  if (download) {
    res.download(filePath);
    return;
  }

  res.sendFile(filePath);
}

async function serveProductImage({ res, product, imageRecord, serveOptions }) {
  const cacheControl = `public, max-age=${DYNAMIC_CACHE_MAX_AGE_SECONDS}, immutable`;
  const existingVariant = (imageRecord.variants || []).find(
    (variant) => variant.key === serveOptions.variant.key && variant.format === serveOptions.format
  );
  const canReuseExistingVariant = existingVariant
    && (!serveOptions.width || (existingVariant.width && existingVariant.width <= serveOptions.width))
    && (!serveOptions.height || (existingVariant.height && existingVariant.height <= serveOptions.height));

  if (canReuseExistingVariant && await fileExists(resolveFromRoot(existingVariant.relativePath))) {
    await serveVariantFile(res, resolveFromRoot(existingVariant.relativePath), {
      download: res.req.query.download === "1",
      cacheControl
    });
    return {
      mode: "pre-generated",
      variant: existingVariant
    };
  }

  const productSlug = sanitizeIdentifier(product.productId);
  const dynamicKey = hashDynamicOptions({
    variant: serveOptions.variant.key,
    width: serveOptions.width,
    height: serveOptions.height,
    fit: serveOptions.fit,
    format: serveOptions.format,
    quality: serveOptions.quality,
    watermark: imageRecord.processing?.watermark || {}
  });
  const dynamicDir = path.join(PRODUCT_PROCESSED_DIR, productSlug, imageRecord.imageId, "dynamic");
  const fileName = buildDynamicVariantName({
    variantKey: serveOptions.variant.key,
    cacheKey: dynamicKey,
    extension: serveOptions.format
  });
  const outputPath = path.join(dynamicDir, fileName);

  if (!(await fileExists(outputPath))) {
    try {
      await writeDerivative({
      sourcePath: resolveFromRoot(imageRecord.source.relativePath),
      outputPath,
      profile: {
        ...serveOptions.variant,
        width: serveOptions.width,
        height: serveOptions.height
      },
      format: serveOptions.format,
      quality: serveOptions.quality,
      stripMetadata: true,
      watermark: imageRecord.processing?.watermark,
      fit: serveOptions.fit
      });
    } catch {
      const originalPath = resolveFromRoot(imageRecord.source.relativePath);
      await serveVariantFile(res, originalPath, {
        download: res.req.query.download === "1",
        cacheControl: "public, max-age=300"
      });
      return {
        mode: "fallback",
        relativePath: imageRecord.source.relativePath
      };
    }
  }

  await serveVariantFile(res, outputPath, {
    download: res.req.query.download === "1",
    cacheControl
  });

  return {
    mode: "dynamic",
    relativePath: toRelativePath(outputPath)
  };
}

async function buildImageRecord({
  product,
  imageId,
  role,
  originalName,
  sourcePath,
  format,
  size,
  metadata,
  relativePath
}) {
  const altText = generateBaseAltText({
    brand: product.brand,
    name: product.name,
    category: product.category,
    attributes: product.attributes
  }, role);

  return {
    imageId,
    role,
    originalName,
    altText,
    source: {
      format,
      size,
      width: metadata.width,
      height: metadata.height,
      relativePath,
      fileName: path.basename(sourcePath)
    },
    variants: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  buildImageRecord,
  processProductImage,
  serveProductImage
};
