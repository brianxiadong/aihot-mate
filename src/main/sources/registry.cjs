const { createAihotAdapter } = require("./aihot.cjs");
const { createRssAdapter } = require("./rss.cjs");

function createAdapter(source) {
  if (source.type === "aihot") return createAihotAdapter(source);
  if (source.type === "rss") return createRssAdapter(source);
  return null;
}

function getEnabledAdapters(sources) {
  return sources.filter((source) => source.enabled !== false).map(createAdapter).filter(Boolean);
}

module.exports = {
  createAdapter,
  getEnabledAdapters
};
