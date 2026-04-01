const path = require("path");

const {
  ALLOWED_FORMATS,
  DEFAULT_PRODUCT_PROFILE_KEYS,
  PRODUCT_IMAGE_PROFILES,
  CONTEXT_IMAGE_PROFILES,
  DEVICE_WIDTHS,
  WATERMARK_LOGO_PATH,
  WATERMARK_TEXT
} = require("./config");
const { AppError } = require("./errors");
const { normalizeBoolean } = require("./processOptions");

const PROFILE_CATALOG = {
  ...PRODUCT_IMAGE_PROFILES,
  ...CONTEXT_IMAGE_PROFILES
};

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function maybeParseJson(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFormat(format) {
  const normalized = String(format || "webp").toLowerCase();

  if (!ALLOWED_FORMATS.has(normalized)) {
    throw new AppError(400, "Unsupported output format", {
      allowedFormats: Array.from(ALLOWED_FORMATS)
    });
  }

  return normalized === "jpg" ? "jpeg" : normalized;
}

function normalizeRoles(value, fileCount) {
  const explicitRoles = normalizeList(value);

  return Array.from({ length: fileCount }, (_, index) => {
    return explicitRoles[index] || (index === 0 ? "primary" : `gallery-${index}`);
  });
}

function normalizeProfiles(value) {
  const requested = normalizeList(value).map((item) => item.toLowerCase());
  const selected = requested.length ? requested : DEFAULT_PRODUCT_PROFILE_KEYS;
  const invalid = selected.find((item) => !PROFILE_CATALOG[item]);

  if (invalid) {
    throw new AppError(400, "Invalid product image profile requested", {
      allowedProfiles: Object.keys(PROFILE_CATALOG)
    });
  }

  return [...new Set(selected)].map((key) => PROFILE_CATALOG[key]);
}

function normalizeWatermark(body, product) {
  const watermarkBody = maybeParseJson(body.watermark, {}) || {};
  const categorySettings = maybeParseJson(body.categorySettings, {}) || {};
  const enabled = watermarkBody.enabled !== undefined
    ? normalizeBoolean(watermarkBody.enabled, false)
    : normalizeBoolean(body.watermarkEnabled, normalizeBoolean(categorySettings.enableWatermark, false));

  const opacitySource = watermarkBody.opacity ?? body.watermarkOpacity;
  const opacity = opacitySource === undefined || opacitySource === ""
    ? 0.18
    : Number.parseFloat(opacitySource);

  return {
    enabled,
    position: String(watermarkBody.position || body.watermarkPosition || "southeast").toLowerCase(),
    opacity: Number.isNaN(opacity) ? 0.18 : Math.max(0.05, Math.min(0.9, opacity)),
    text: String(watermarkBody.text || body.watermarkText || WATERMARK_TEXT || product.brand || "").trim(),
    logoPath: String(watermarkBody.logoPath || body.watermarkLogoPath || WATERMARK_LOGO_PATH || "").trim()
  };
}

function normalizeProductMetadata(body) {
  const productId = String(body.productId || "").trim();

  if (!productId) {
    throw new AppError(400, "productId is required");
  }

  const parsedAttributes = maybeParseJson(body.attributes, {}) || {};
  const featureFlags = maybeParseJson(body.featureFlags, {}) || {};
  const categorySettings = maybeParseJson(body.categorySettings, {}) || {};

  return {
    productId,
    name: String(body.productName || "").trim(),
    brand: String(body.brand || "").trim(),
    category: String(body.category || "").trim(),
    attributes: {
      color: String(parsedAttributes.color || body.color || "").trim(),
      type: String(parsedAttributes.type || body.type || "").trim(),
      gender: String(parsedAttributes.gender || body.gender || "").trim()
    },
    featureFlags,
    categorySettings
  };
}

function normalizeProductUploadOptions(body, fileCount) {
  const product = normalizeProductMetadata(body);
  const quality = normalizeNumber(body.quality ?? 82);

  if (quality === undefined || quality < 1 || quality > 100) {
    throw new AppError(400, "Quality must be a number between 1 and 100");
  }

  return {
    product,
    roles: normalizeRoles(body.roles, fileCount),
    autoProcess: normalizeBoolean(body.autoProcess, true),
    profiles: normalizeProfiles(body.profiles),
    format: normalizeFormat(body.format),
    quality,
    stripMetadata: normalizeBoolean(body.stripMetadata, true),
    watermark: normalizeWatermark(body, product)
  };
}

function normalizeProductProcessOptions(body) {
  const product = normalizeProductMetadata(body);
  const quality = normalizeNumber(body.quality ?? 82);

  if (quality === undefined || quality < 1 || quality > 100) {
    throw new AppError(400, "Quality must be a number between 1 and 100");
  }

  return {
    product,
    imageIds: normalizeList(body.imageIds),
    profiles: normalizeProfiles(body.profiles),
    format: normalizeFormat(body.format),
    quality,
    stripMetadata: normalizeBoolean(body.stripMetadata, true),
    watermark: normalizeWatermark(body, product)
  };
}

function resolveRequestedFormat(acceptHeader, requestedFormat, fallbackFormat) {
  if (requestedFormat && requestedFormat !== "auto") {
    return normalizeFormat(requestedFormat);
  }

  const accept = String(acceptHeader || "").toLowerCase();

  if (accept.includes("image/avif")) {
    return "avif";
  }

  if (accept.includes("image/webp")) {
    return "webp";
  }

  return normalizeFormat(fallbackFormat || "jpeg");
}

function normalizeServeOptions(req) {
  const variant = String(req.query.variant || "product").toLowerCase();
  const device = String(req.query.device || "desktop").toLowerCase();
  const width = normalizeNumber(req.query.width);
  const height = normalizeNumber(req.query.height);
  const quality = normalizeNumber(req.query.quality ?? 82);
  const fit = String(req.query.fit || "").toLowerCase();

  if (quality === undefined || quality < 1 || quality > 100) {
    throw new AppError(400, "Quality must be a number between 1 and 100");
  }

  if (width !== undefined && width <= 0) {
    throw new AppError(400, "width must be positive");
  }

  if (height !== undefined && height <= 0) {
    throw new AppError(400, "height must be positive");
  }

  const baseProfile = PROFILE_CATALOG[variant] || PRODUCT_IMAGE_PROFILES.product;
  const deviceProfile = DEVICE_WIDTHS[device] || DEVICE_WIDTHS.desktop;
  const deviceWidthCap = deviceProfile[baseProfile.key] || baseProfile.width;

  return {
    variant: baseProfile,
    device,
    width: width || deviceWidthCap || baseProfile.width,
    height: height || baseProfile.height,
    fit: fit || baseProfile.fit || "inside",
    quality,
    format: resolveRequestedFormat(req.headers.accept, req.query.format, req.query.fallbackFormat)
  };
}

function inferExtension(fileName) {
  return path.extname(fileName || "").replace(/^\./, "").toLowerCase();
}

module.exports = {
  normalizeProductUploadOptions,
  normalizeProductProcessOptions,
  normalizeServeOptions,
  inferExtension
};
