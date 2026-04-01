const express = require("express");
const multer = require("multer");

const { uploadFiles } = require("../controllers/uploadController");
const { processFiles, getBatchStatus } = require("../controllers/processController");
const { downloadFile, downloadZip } = require("../controllers/downloadController");
const {
  uploadProductImages,
  processProductImages,
  getProductManifestHandler,
  getProductImageMeta,
  serveProductImageHandler
} = require("../controllers/productController");
const {
  MAX_BATCH_FILES,
  MAX_FILE_SIZE,
  TEMP_DIR,
  WRITE_RATE_LIMIT_WINDOW_MS,
  WRITE_RATE_LIMIT_MAX
} = require("../utils/config");
const { AppError, asyncHandler } = require("../utils/errors");
const { createMemoryRateLimiter } = require("../utils/rateLimit");

const router = express.Router();

const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_BATCH_FILES
  }
});
const writeLimiter = createMemoryRateLimiter({
  windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
  max: WRITE_RATE_LIMIT_MAX
});

function handleMulterUpload(req, res, next) {
  upload.array("images", MAX_BATCH_FILES)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(new AppError(400, `Each file must be ${Math.floor(MAX_FILE_SIZE / (1024 * 1024))}MB or smaller`));
        return;
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        next(new AppError(400, `You can upload up to ${MAX_BATCH_FILES} files at a time`));
        return;
      }

      next(new AppError(400, error.message));
      return;
    }

    next(error);
  });
}

router.post("/upload", handleMulterUpload, asyncHandler(uploadFiles));

router.post("/process", asyncHandler(processFiles));
router.get("/batches/:batchId", asyncHandler(getBatchStatus));
router.get("/download/:file", asyncHandler(downloadFile));
router.get("/download-zip/:batchId", asyncHandler(downloadZip));
router.post("/api/products/images/upload", writeLimiter, handleMulterUpload, asyncHandler(uploadProductImages));
router.post("/api/products/images/process", writeLimiter, asyncHandler(processProductImages));
router.get("/api/products/:productId/manifest", asyncHandler(getProductManifestHandler));
router.get("/api/products/:productId/images/:imageId/meta", asyncHandler(getProductImageMeta));
router.get("/api/products/:productId/images/:imageId", asyncHandler(serveProductImageHandler));

module.exports = router;
