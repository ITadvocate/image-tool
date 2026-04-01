const uploadBatches = new Map();
const processBatches = new Map();

function createUploadBatch(batch) {
  uploadBatches.set(batch.batchId, {
    ...batch,
    createdAt: new Date().toISOString()
  });

  return uploadBatches.get(batch.batchId);
}

function getUploadBatch(batchId) {
  return uploadBatches.get(batchId);
}

function createProcessBatch(batch) {
  const record = {
    ...batch,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  processBatches.set(batch.batchId, record);
  return record;
}

function updateProcessBatch(batchId, updates) {
  const current = processBatches.get(batchId);

  if (!current) {
    return null;
  }

  const next = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  processBatches.set(batchId, next);
  return next;
}

function getProcessBatch(batchId) {
  return processBatches.get(batchId);
}

function pruneStaleBatches(ttlMs) {
  const now = Date.now();

  for (const [batchId, batch] of uploadBatches.entries()) {
    if (now - new Date(batch.createdAt).getTime() > ttlMs) {
      uploadBatches.delete(batchId);
    }
  }

  for (const [batchId, batch] of processBatches.entries()) {
    if (now - new Date(batch.createdAt).getTime() > ttlMs) {
      processBatches.delete(batchId);
    }
  }
}

module.exports = {
  createUploadBatch,
  getUploadBatch,
  createProcessBatch,
  updateProcessBatch,
  getProcessBatch,
  pruneStaleBatches
};
