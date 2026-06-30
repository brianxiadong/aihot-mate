function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function categoryLabel(category) {
  const labels = {
    "ai-models": "模型发布",
    "ai-products": "产品发布",
    industry: "行业动态",
    paper: "论文研究",
    tip: "技巧观点",
    hot: "当前热点",
    daily: "AI 日报",
    rss: "RSS"
  };
  return labels[category] || "未分类";
}

module.exports = {
  toIsoDate,
  normalizeText,
  categoryLabel
};
