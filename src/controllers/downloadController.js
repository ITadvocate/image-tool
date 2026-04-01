const fs = require("fs/promises");
const archiver = require("archiver");

const { PROCESSED_DIR } = require("../utils/config");
const { AppError } = require("../utils/errors");
const { resolveSafeFilePath } = require("../services/fileService");
const { getProcessBatch } = require("../services/batchStore");

async function downloadFile(req, res) {
  const filePath = resolveSafeFilePath(PROCESSED_DIR, req.params.file);

  if (!filePath) {
    throw new AppError(400, "Invalid file path");
  }

  await fs.access(filePath).catch(() => {
    throw new AppError(404, "Processed file not found");
  });

  if (req.query.inline === "1") {
    res.sendFile(filePath);
    return;
  }

  res.download(filePath);
}

async function downloadZip(req, res, next) {
  const batch = getProcessBatch(req.params.batchId);

  if (!batch) {
    throw new AppError(404, "Processed batch not found");
  }

  if (batch.status !== "completed") {
    throw new AppError(409, "Batch is not ready for zip download yet");
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${batch.batchId}.zip"`
  );

  const archive = archiver("zip", {
    zlib: { level: 9 }
  });

  archive.on("error", next);
  archive.pipe(res);

  for (const file of batch.files) {
    archive.file(file.path, { name: file.fileName });
  }

  await archive.finalize();
}

module.exports = {
  downloadFile,
  downloadZip
};
