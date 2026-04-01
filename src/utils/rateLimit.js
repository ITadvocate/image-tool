const { AppError } = require("./errors");

function createMemoryRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  return function rateLimit(req, _res, next) {
    const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(key, {
        startedAt: now,
        count: 1
      });
      next();
      return;
    }

    if (bucket.count >= max) {
      next(new AppError(429, "Rate limit exceeded. Please retry shortly."));
      return;
    }

    bucket.count += 1;
    next();
  };
}

module.exports = {
  createMemoryRateLimiter
};
