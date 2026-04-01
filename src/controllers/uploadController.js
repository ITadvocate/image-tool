const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const { DETECTED_FORMATS, UPLOAD_DIR } = require("../utils/config");
const { AppError } = require("../utils/errors");
const { createUploadBatch } = require("../services/batchStore");
const {
  createBatchId,
  sanitizeBaseName,
  buildStoredName,
  removeFile
} = require("../services/fileService");

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
        format: detectedFormat
      };
    })
  );
}

async function uploadFiles(req, res) {
  const files = req.files || [];

  if (files.length === 0) {
    throw new AppError(400, "Please upload at least one image");
  }

  let validatedFiles;

  try {
    validatedFiles = await validateImages(files);
  } catch (error) {
    await Promise.all(files.map((file) => removeFile(file.path)));
    throw error;
  }

  const batchId = createBatchId();
  const storedFiles = [];

  try {
    for (const file of validatedFiles) {
      const fileId = createBatchId();
      const storedName = buildStoredName(sanitizeBaseName(file.originalName), file.format);
      const destinationPath = path.join(UPLOAD_DIR, storedName);

      await fs.rename(file.tempPath, destinationPath);

      storedFiles.push({
        id: fileId,
        originalName: file.originalName,
        storedName,
        path: destinationPath,
        mimeType: `image/${file.format === "jpeg" ? "jpeg" : file.format}`,
        size: file.size
      });
    }
  } catch (error) {
    await Promise.all([
      ...validatedFiles.map((file) => removeFile(file.tempPath)),
      ...storedFiles.map((file) => removeFile(file.path))
    ]);
    throw error;
  }

  createUploadBatch({
    batchId,
    files: storedFiles
  });

  res.status(201).json({
    success: true,
    batchId,
    totalFiles: storedFiles.length,
    files: storedFiles.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      size: file.size
    }))
  });
}

module.exports = {
  uploadFiles
};
