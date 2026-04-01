const { ALLOWED_FORMATS, PRESETS } = require("./config");
const { AppError } = require("./errors");

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  }

  return Boolean(value);
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeFormat(format) {
  const normalized = String(format || "webp").toLowerCase();

  if (!ALLOWED_FORMATS.has(normalized)) {
    throw new AppError(400, "Unsupported output format", {
      allowedFormats: Array.from(ALLOWED_FORMATS)
    });
  }

  if (normalized === "jpg") {
    return {
      requestedFormat: "jpg",
      sharpFormat: "jpeg",
      extension: "jpg"
    };
  }

  return {
    requestedFormat: normalized,
    sharpFormat: normalized,
    extension: normalized
  };
}

function normalizePresetList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).toLowerCase().trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.toLowerCase().trim())
      .filter(Boolean);
  }

  return [];
}

function buildPresetOutput(preset) {
  return {
    type: "preset",
    preset,
    key: preset,
    label: preset,
    ...PRESETS[preset]
  };
}

function parseResizeOutputs(body) {
  const resize = typeof body.resize === "object" && body.resize !== null ? body.resize : {};
  const legacyPreset = (resize.preset || body.resizePreset || body.preset || "").toLowerCase();
  const presets = [
    ...normalizePresetList(body.resizePresets),
    ...normalizePresetList(resize.presets)
  ];

  if (legacyPreset) {
    presets.push(legacyPreset);
  }

  const uniquePresets = [...new Set(presets)];
  const invalidPreset = uniquePresets.find((preset) => !PRESETS[preset]);

  if (invalidPreset) {
    throw new AppError(400, "Invalid resize preset", {
      allowedPresets: Object.keys(PRESETS)
    });
  }

  const width = normalizeNumber(resize.width || body.width);
  const height = normalizeNumber(resize.height || body.height);

  if ((width !== undefined && width <= 0) || (height !== undefined && height <= 0)) {
    throw new AppError(400, "Width and height must be positive integers");
  }

  const outputs = uniquePresets.map(buildPresetOutput);

  if (width !== undefined || height !== undefined) {
    outputs.push({
      type: "custom",
      key: "custom",
      label: "custom",
      prefix: "custom_",
      width,
      height
    });
  }

  if (outputs.length === 0) {
    outputs.push({
      type: "original",
      key: "original",
      label: "original",
      prefix: ""
    });
  }

  return outputs;
}

function extractFileIds(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeProcessOptions(body) {
  const quality = normalizeNumber(body.quality ?? 80);

  if (quality === undefined || quality < 1 || quality > 100) {
    throw new AppError(400, "Quality must be a number between 1 and 100");
  }

  return {
    batchId: body.batchId,
    fileIds: extractFileIds(body.fileIds),
    format: normalizeFormat(body.format),
    outputs: parseResizeOutputs(body),
    quality,
    maintainAspectRatio: normalizeBoolean(body.maintainAspectRatio, true),
    stripMetadata: normalizeBoolean(body.stripMetadata, true)
  };
}

module.exports = {
  normalizeBoolean,
  normalizeProcessOptions
};
