const fs = require("fs/promises");
const path = require("path");

const {
  TEMP_DIR,
  TEMP_FILE_TTL_MS,
  CLEANUP_INTERVAL_MS,
  BATCH_RECORD_TTL_MS
} = require("./config");
const { pruneStaleBatches } = require("../services/batchStore");

let cleanupStarted = false;

async function cleanupTempDirectory() {
  const entries = await fs.readdir(TEMP_DIR, { withFileTypes: true });
  const now = Date.now();

  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const entryPath = path.join(TEMP_DIR, entry.name);
        const stats = await fs.stat(entryPath);

        if (now - stats.mtimeMs > TEMP_FILE_TTL_MS) {
          await fs.unlink(entryPath).catch(() => undefined);
        }
      })
  );
}

function startCleanupJob() {
  if (cleanupStarted) {
    return;
  }

  cleanupStarted = true;

  const runCleanup = async () => {
    try {
      await cleanupTempDirectory();
      pruneStaleBatches(BATCH_RECORD_TTL_MS);
    } catch (error) {
      console.error("Cleanup job failed", error);
    }
  };

  void runCleanup();

  const timer = setInterval(() => {
    void runCleanup();
  }, CLEANUP_INTERVAL_MS);

  timer.unref();
}

module.exports = {
  startCleanupJob
};
