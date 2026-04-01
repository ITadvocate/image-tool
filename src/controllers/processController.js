const { getUploadBatch, createProcessBatch, updateProcessBatch, getProcessBatch } = require("../services/batchStore");
const { processBatchFiles } = require("../services/imageService");
const { enqueue, getQueueState } = require("../services/queueService");
const { createBatchId } = require("../services/fileService");
const { normalizeProcessOptions } = require("../utils/processOptions");
const { AppError } = require("../utils/errors");

function buildResponse(record) {
  return {
    success: true,
    batchId: record.batchId,
    sourceBatchId: record.sourceBatchId,
    status: record.status,
    progress: record.progress,
    queue: record.queue,
    options: {
      format: record.options.format.requestedFormat,
      quality: record.options.quality,
      maintainAspectRatio: record.options.maintainAspectRatio,
      stripMetadata: record.options.stripMetadata,
      outputs: record.options.outputs
    },
    files: record.files.map((file) => ({
      inputFileId: file.inputFileId,
      originalName: file.originalName,
      variant: file.variant,
      fileName: file.fileName,
      format: file.format,
      width: file.width,
      height: file.height,
      size: file.size,
      downloadUrl: `/download/${file.fileName}`,
      previewUrl: `/download/${file.fileName}?inline=1`
    })),
    downloadZipUrl: `/download-zip/${record.batchId}`
  };
}

async function processFiles(req, res) {
  const options = normalizeProcessOptions(req.body);

  if (!options.batchId) {
    throw new AppError(400, "batchId is required");
  }

  const uploadBatch = getUploadBatch(options.batchId);

  if (!uploadBatch) {
    throw new AppError(404, "Upload batch not found");
  }

  const selectedFiles = options.fileIds.length
    ? uploadBatch.files.filter((file) => options.fileIds.includes(file.id))
    : uploadBatch.files;

  if (selectedFiles.length === 0) {
    throw new AppError(400, "No matching uploaded files found for processing");
  }

  if (options.fileIds.length && selectedFiles.length !== options.fileIds.length) {
    throw new AppError(400, "One or more fileIds do not belong to the provided batch");
  }

  const processBatchId = createBatchId();

  createProcessBatch({
    batchId: processBatchId,
    sourceBatchId: uploadBatch.batchId,
    status: "queued",
    progress: {
      total: selectedFiles.length * options.outputs.length,
      completed: 0
    },
    queue: getQueueState(),
    options,
    files: []
  });

  await enqueue(async () => {
    updateProcessBatch(processBatchId, {
      status: "processing",
      queue: getQueueState()
    });

    try {
      const files = await processBatchFiles({
        processBatchId,
        files: selectedFiles,
        options,
        onProgress: (completed, total) => {
          updateProcessBatch(processBatchId, {
            progress: {
              completed,
              total
            }
          });
        }
      });

      updateProcessBatch(processBatchId, {
        status: "completed",
        files,
        progress: {
          total: selectedFiles.length * options.outputs.length,
          completed: selectedFiles.length * options.outputs.length
        },
        queue: getQueueState()
      });
    } catch (error) {
      updateProcessBatch(processBatchId, {
        status: "failed",
        error: error.message,
        queue: getQueueState()
      });
      throw error;
    }
  });

  const processedRecord = updateProcessBatch(processBatchId, {
    queue: getQueueState()
  });

  res.json(buildResponse(processedRecord));
}

async function getBatchStatus(req, res) {
  const batch = getProcessBatch(req.params.batchId);

  if (!batch) {
    throw new AppError(404, "Processed batch not found");
  }

  res.json(buildResponse(batch));
}

module.exports = {
  processFiles,
  getBatchStatus
};
