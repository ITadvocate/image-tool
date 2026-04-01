const express = require("express");
const cors = require("cors");

const routes = require("./src/routes");
const { ensureDirectories } = require("./src/services/fileService");
const { startCleanupJob } = require("./src/utils/cleanup");
const { AppError } = require("./src/utils/errors");
const { APP_PORT, PUBLIC_DIR } = require("./src/utils/config");

async function startServer() {
  await ensureDirectories();

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(PUBLIC_DIR));

  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      status: "ok"
    });
  });

  app.use(routes);

  app.use((req, _res, next) => {
    next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      console.error(error);
    }

    res.status(statusCode).json({
      success: false,
      message: error.message || "Internal server error",
      ...(error.details ? { details: error.details } : {})
    });
  });

  startCleanupJob();

  app.listen(APP_PORT, () => {
    console.log(`Image converter service listening on port ${APP_PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
