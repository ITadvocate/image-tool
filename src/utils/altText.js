function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function dedupeSegments(segments) {
  const seen = new Set();
  const result = [];

  for (const segment of segments) {
    const normalized = String(segment || "").trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function generateBaseAltText(product, imageRole) {
  const attributes = product.attributes || {};
  const segments = dedupeSegments([
    titleCase(product.brand),
    titleCase(product.name),
    titleCase(attributes.type),
    titleCase(product.category),
    titleCase(attributes.color),
    attributes.gender ? `${titleCase(attributes.gender)} collection` : "",
    imageRole ? `${titleCase(imageRole)} view` : ""
  ]);

  return segments.join(", ");
}

function generateVariantAltText(baseAltText, variantKey) {
  const suffixByVariant = {
    thumbnail: "thumbnail image",
    listing: "listing image",
    product: "product detail image",
    zoom: "zoom image",
    square: "square campaign image",
    vertical: "vertical banner image",
    horizontal: "horizontal slider image"
  };

  const suffix = suffixByVariant[variantKey];
  return suffix ? `${baseAltText}, ${suffix}` : baseAltText;
}

module.exports = {
  generateBaseAltText,
  generateVariantAltText
};
