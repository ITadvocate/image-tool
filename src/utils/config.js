const path = require("path");

const ROOT_DIR = process.cwd();

const APP_PORT = Number.parseInt(process.env.PORT || "3000", 10);
const MAX_FILE_SIZE = Number.parseInt(process.env.MAX_FILE_SIZE_BYTES || `${5 * 1024 * 1024}`, 10);
const MAX_BATCH_FILES = Number.parseInt(process.env.MAX_BATCH_FILES || "20", 10);
const TEMP_FILE_TTL_MS = Number.parseInt(process.env.TEMP_FILE_TTL_MS || `${60 * 60 * 1000}`, 10);
const CLEANUP_INTERVAL_MS = Number.parseInt(process.env.CLEANUP_INTERVAL_MS || `${15 * 60 * 1000}`, 10);
const BATCH_RECORD_TTL_MS = Number.parseInt(process.env.BATCH_RECORD_TTL_MS || `${24 * 60 * 60 * 1000}`, 10);
const DYNAMIC_CACHE_MAX_AGE_SECONDS = Number.parseInt(process.env.DYNAMIC_CACHE_MAX_AGE_SECONDS || `${7 * 24 * 60 * 60}`, 10);
const WRITE_RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.WRITE_RATE_LIMIT_WINDOW_MS || "60000", 10);
const WRITE_RATE_LIMIT_MAX = Number.parseInt(process.env.WRITE_RATE_LIMIT_MAX || "120", 10);
const WATERMARK_LOGO_PATH = process.env.WATERMARK_LOGO_PATH || "";
const WATERMARK_TEXT = process.env.WATERMARK_TEXT || "";

const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const PROCESSED_DIR = path.join(ROOT_DIR, "processed");
const TEMP_DIR = path.join(ROOT_DIR, "temp");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const PRODUCT_UPLOAD_DIR = path.join(UPLOAD_DIR, "products");
const PRODUCT_PROCESSED_DIR = path.join(PROCESSED_DIR, "products");

const ALLOWED_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "avif", "tiff"]);
const DETECTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "tiff"]);
const PRESETS = {
  thumb: {
    prefix: "thumb_",
    width: 150,
    height: 150
  },
  small: {
    prefix: "small_",
    width: 300
  },
  medium: {
    prefix: "medium_",
    width: 600
  },
  large: {
    prefix: "large_",
    width: 1200
  }
};

const PRODUCT_IMAGE_PROFILES = {
  thumbnail: {
    key: "thumbnail",
    label: "thumbnail",
    category: "commerce",
    prefix: "thumbnail",
    width: 180,
    height: 180,
    fit: "cover",
    position: "attention"
  },
  listing: {
    key: "listing",
    label: "listing",
    category: "commerce",
    prefix: "listing",
    width: 420,
    height: 420,
    fit: "cover",
    position: "attention"
  },
  product: {
    key: "product",
    label: "product",
    category: "commerce",
    prefix: "product",
    width: 960,
    height: 960,
    fit: "inside",
    position: "centre"
  },
  zoom: {
    key: "zoom",
    label: "zoom",
    category: "commerce",
    prefix: "zoom",
    width: 1800,
    height: 1800,
    fit: "inside",
    position: "centre"
  }
};

const CONTEXT_IMAGE_PROFILES = {
  square: {
    key: "square",
    label: "square",
    category: "context",
    prefix: "square",
    width: 1080,
    height: 1080,
    fit: "cover",
    position: "attention"
  },
  vertical: {
    key: "vertical",
    label: "vertical",
    category: "context",
    prefix: "vertical",
    width: 1080,
    height: 1350,
    fit: "cover",
    position: "attention"
  },
  horizontal: {
    key: "horizontal",
    label: "horizontal",
    category: "context",
    prefix: "horizontal",
    width: 1600,
    height: 900,
    fit: "cover",
    position: "attention"
  }
};

const DEFAULT_PRODUCT_PROFILE_KEYS = [
  "thumbnail",
  "listing",
  "product",
  "zoom",
  "square",
  "vertical",
  "horizontal"
];

const DEVICE_WIDTHS = {
  mobile: {
    thumbnail: 140,
    listing: 320,
    product: 640,
    zoom: 960,
    square: 540,
    vertical: 540,
    horizontal: 720
  },
  tablet: {
    thumbnail: 180,
    listing: 480,
    product: 900,
    zoom: 1280,
    square: 720,
    vertical: 810,
    horizontal: 1080
  },
  desktop: {
    thumbnail: 220,
    listing: 640,
    product: 1200,
    zoom: 1800,
    square: 1080,
    vertical: 1350,
    horizontal: 1600
  }
};

module.exports = {
  APP_PORT,
  ROOT_DIR,
  UPLOAD_DIR,
  PROCESSED_DIR,
  TEMP_DIR,
  PUBLIC_DIR,
  PRODUCT_UPLOAD_DIR,
  PRODUCT_PROCESSED_DIR,
  MAX_FILE_SIZE,
  MAX_BATCH_FILES,
  TEMP_FILE_TTL_MS,
  CLEANUP_INTERVAL_MS,
  BATCH_RECORD_TTL_MS,
  DYNAMIC_CACHE_MAX_AGE_SECONDS,
  WRITE_RATE_LIMIT_WINDOW_MS,
  WRITE_RATE_LIMIT_MAX,
  WATERMARK_LOGO_PATH,
  WATERMARK_TEXT,
  ALLOWED_FORMATS,
  DETECTED_FORMATS,
  PRESETS,
  PRODUCT_IMAGE_PROFILES,
  CONTEXT_IMAGE_PROFILES,
  DEFAULT_PRODUCT_PROFILE_KEYS,
  DEVICE_WIDTHS
};
