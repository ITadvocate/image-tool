const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const { DETECTED_FORMATS } = require("../utils/config");
const { AppError } = require("../utils/errors");
const {
  normalizeProductUploadOptions,
  normalizeProductProcessOptions,
  normalizeServeOptions
} = require("../utils/productOptions");
const { createBatchId, buildProductOriginalName, ensureDir, toRelativePath, removeFile } = require("../services/fileService");
const { getQueueState, enqueue } = require("../services/queueService");
const {
  getProductDirectory,
  getProductManifest,
  getProductImage,
  upsertProductImages
} = require("../services/manifestService");
const { buildImageRecord, processProductImage, serveProductImage } = require("../services/productImageService");

async function validateImages(files) {
  return Promise.all(
    files.map(async (file) => {
      const metadata = await sharp(file.path).metadata().catch(() => null);
      const detectedFormat = metadata?.format?.toLowerCase();

      if (!detectedFormat || !DETECTED_FORMATS.has(detectedFormat)) {
        throw new AppError(400, `Unsupported or invalid image file: ${file.originalname}`);
      }

      return {
        tempPath: file.path,
        originalName: file.originalname,
        size: file.size,
        format: detectedFormat,
        metadata
      };
    })
  );
}

function buildProductResponse(manifest, processedImages = []) {
  return {
    success: true,
    productId: manifest.productId,
    queue: getQueueState(),
    metadata: manifest.metadata,
    images: manifest.images.map((image) => ({
      imageId: image.imageId,
      role: image.role,
      altText: image.altText,
      originalName: image.originalName,
      source: image.source,
      variants: image.variants.map((variant) => ({
        key: variant.key,
        label: variant.label,
        category: variant.category,
        width: variant.width,
        height: variant.height,
        format: variant.format,
        size: variant.size,
        altText: variant.altText,
        url: `/api/products/${manifest.productId}/images/${image.imageId}?variant=${variant.key}&format=${variant.format}`
      }))
    })),
    processedImageIds: processedImages.map((image) => image.imageId)
  };
}

async function uploadProductImages(req, res) {
  const files = req.files || [];

  if (!files.length) {
    throw new AppError(400, "Please upload at least one image");
  }

  const options = normalizeProductUploadOptions(req.body, files.length);
  let validatedFiles;

  try {
    validatedFiles = await validateImages(files);
  } catch (error) {
    await Promise.all(files.map((file) => removeFile(file.path)));
    throw error;
  }

  const { productDir } = getProductDirectory(options.product.productId);
  const productImages = [];

  try {
    for (const [index, file] of validatedFiles.entries()) {
      const imageId = createBatchId();
      const role = options.roles[index];
      const imageDir = path.join(productDir, imageId);
      const originalName = buildProductOriginalName(file.format);
      const destinationPath = path.join(imageDir, originalName);

      await ensureDir(imageDir);
      await fs.rename(file.tempPath, destinationPath);

      const imageRecord = await buildImageRecord({
        product: options.product,
        imageId,
        role,
        originalName: file.originalName,
        sourcePath: destinationPath,
        format: file.format,
        size: file.size,
        metadata: file.metadata,
        relativePath: toRelativePath(destinationPath)
      });

      productImages.push(imageRecord);
    }
  } catch (error) {
    await Promise.all([
      ...validatedFiles.map((file) => removeFile(file.tempPath)),
      ...productImages.map((image) => removeFile(path.resolve(process.cwd(), image.source.relativePath)))
    ]);
    throw error;
  }

  let manifest = await upsertProductImages({
    productId: options.product.productId,
    metadata: options.product,
    images: productImages
  });
  const processedImages = [];

  if (options.autoProcess) {
    await enqueue(async () => {
      for (const image of productImages) {
        const processedImage = await processProductImage({
          product: options.product,
          imageRecord: image,
          profiles: options.profiles,
          format: options.format,
          quality: options.quality,
          stripMetadata: options.stripMetadata,
          watermark: options.watermark
        });
        processedImages.push(processedImage);
      }
    });

    manifest = await getProductManifest(options.product.productId);
  }

  res.status(201).json(buildProductResponse(manifest, processedImages));
}

async function processProductImages(req, res) {
  const options = normalizeProductProcessOptions(req.body);
  const manifest = await getProductManifest(options.product.productId);

  if (!manifest) {
    throw new AppError(404, "Product manifest not found");
  }

  const selectedImages = options.imageIds.length
    ? manifest.images.filter((image) => options.imageIds.includes(image.imageId))
    : manifest.images;
  const productContext = {
    ...(manifest.metadata || {}),
    ...options.product,
    attributes: {
      ...((manifest.metadata && manifest.metadata.attributes) || {}),
      ...(options.product.attributes || {})
    }
  };
  const watermark = {
    ...options.watermark,
    text: options.watermark.text || (manifest.metadata && manifest.metadata.brand) || ""
  };

  if (!selectedImages.length) {
    throw new AppError(400, "No product images matched the requested imageIds");
  }

  const processedImages = [];

  await enqueue(async () => {
    for (const image of selectedImages) {
      const processedImage = await processProductImage({
        product: productContext,
        imageRecord: image,
        profiles: options.profiles,
        format: options.format,
        quality: options.quality,
        stripMetadata: options.stripMetadata,
        watermark
      });
      processedImages.push(processedImage);
    }
  });

  const nextManifest = await getProductManifest(options.product.productId);
  res.json(buildProductResponse(nextManifest, processedImages));
}

async function getProductManifestHandler(req, res) {
  const manifest = await getProductManifest(req.params.productId);

  if (!manifest) {
    throw new AppError(404, "Product manifest not found");
  }

  res.json(buildProductResponse(manifest));
}

async function getProductImageMeta(req, res) {
  const image = await getProductImage(req.params.productId, req.params.imageId);

  if (!image) {
    throw new AppError(404, "Product image not found");
  }

  res.json({
    success: true,
    productId: req.params.productId,
    image
  });
}

async function serveProductImageHandler(req, res) {
  const manifest = await getProductManifest(req.params.productId);

  if (!manifest) {
    throw new AppError(404, "Product manifest not found");
  }

  const image = manifest.images.find((item) => item.imageId === req.params.imageId);

  if (!image) {
    throw new AppError(404, "Product image not found");
  }

  await serveProductImage({
    res,
    product: manifest.metadata,
    imageRecord: image,
    serveOptions: normalizeServeOptions(req)
  });
}

module.exports = {
  uploadProductImages,
  processProductImages,
  getProductManifestHandler,
  getProductImageMeta,
  serveProductImageHandler
};
