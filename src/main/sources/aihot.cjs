const { toIsoDate } = require("./types.cjs");

const BASE_URL = "https://aihot.virxact.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-mate/0.1.0";

function requestUrl(pathname, params = {}) {
  const url = new URL(pathname, BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function fetchJson(url, etag) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...(etag ? { "If-None-Match": etag } : {})
    }
  });

  const nextEtag = response.headers.get("etag");
  if (response.status === 304) {
    return { status: 304, etag: nextEtag || etag, data: null };
  }

  if (!response.ok) {
    throw new Error(`AIHOT request failed with ${response.status}: ${url}`);
  }

  return { status: response.status, etag: nextEtag, data: await response.json() };
}

function normalizeItem(raw, sourceId, sourceName) {
  return {
    id: `${sourceId}:item:${raw.id}`,
    externalId: raw.id,
    sourceId,
    sourceName,
    channel: "AIHOT 精选",
    title: raw.title || raw.title_en || "未命名内容",
    summary: raw.summary || "",
    url: raw.permalink || raw.url,
    originalUrl: raw.url,
    readerUrl: raw.permalink || raw.url,
    publishedAt: toIsoDate(raw.publishedAt),
    category: raw.category || "rss",
    score: typeof raw.score === "number" ? raw.score : null,
    selected: Boolean(raw.selected),
    kind: "item",
    badges: raw.selected ? ["精选"] : [],
    raw
  };
}

function normalizeHotTopic(raw, sourceId, sourceName) {
  return {
    id: `${sourceId}:hot:${raw.id}`,
    externalId: raw.id,
    sourceId,
    sourceName,
    channel: "当前热点",
    title: raw.title || "未命名热点",
    summary: `${raw.sourceCount || 1} 个来源正在报道：${(raw.sourceNames || []).slice(0, 4).join("、")}`,
    url: raw.permalink || raw.url,
    originalUrl: raw.url,
    readerUrl: raw.permalink || raw.url,
    publishedAt: toIsoDate(raw.latestAt),
    category: "hot",
    score: null,
    selected: true,
    kind: "hot-topic",
    sourceCount: raw.sourceCount || 1,
    badges: ["热点", `${raw.sourceCount || 1} 来源`],
    raw
  };
}

function normalizeDaily(data, sourceId, sourceName) {
  if (!data || !data.date) return null;
  const leadTitle = data.lead && data.lead.title ? data.lead.title : `AI HOT 日报 ${data.date}`;
  const sectionCount = Array.isArray(data.sections)
    ? data.sections.reduce((count, section) => count + (Array.isArray(section.items) ? section.items.length : 0), 0)
    : 0;

  const contentParts = [];
  if (data.lead && data.lead.leadParagraph) {
    contentParts.push(`<p>${escapeHtml(data.lead.leadParagraph)}</p>`);
  }
  if (Array.isArray(data.sections)) {
    data.sections.forEach((section) => {
      contentParts.push(`<h2>${escapeHtml(section.label)}</h2>`);
      if (Array.isArray(section.items)) {
        section.items.forEach((item) => {
          const href = item.permalink || item.sourceUrl || "";
          contentParts.push(
            `<article><h3>${escapeHtml(item.title || "")}</h3><p>${escapeHtml(item.summary || "")}</p>${
              href ? `<p><a href="${escapeAttribute(href)}">${escapeHtml(item.sourceName || "阅读全文")}</a></p>` : ""
            }</article>`
          );
        });
      }
    });
  }

  return {
    id: `${sourceId}:daily:${data.date}`,
    externalId: data.date,
    sourceId,
    sourceName,
    channel: "AIHOT 日报",
    title: leadTitle,
    summary: `${data.date} 日报，包含 ${sectionCount} 条精选内容。`,
    url: `${BASE_URL}/daily/${data.date}`,
    originalUrl: `${BASE_URL}/daily/${data.date}`,
    readerUrl: `${BASE_URL}/daily/${data.date}`,
    publishedAt: toIsoDate(data.generatedAt || data.windowEnd),
    category: "daily",
    score: null,
    selected: true,
    kind: "daily",
    badges: ["日报"],
    embeddedArticle: {
      title: leadTitle,
      byline: sourceName,
      excerpt: data.lead ? data.lead.leadParagraph || "" : "",
      siteName: sourceName,
      content: contentParts.join("\n"),
      sourceUrl: `${BASE_URL}/daily/${data.date}`,
      fetchedAt: new Date().toISOString()
    },
    raw: data
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function createAihotAdapter(source) {
  const sourceId = source.id;
  const sourceName = source.name || "AIHOT";

  return {
    id: sourceId,
    name: sourceName,
    type: "aihot",
    async sync(context) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const queries = [
        {
          key: `${sourceId}:items:selected`,
          url: requestUrl("/api/public/items", { mode: "selected", since, take: 80 }),
          map: (data) => (Array.isArray(data.items) ? data.items.map((item) => normalizeItem(item, sourceId, sourceName)) : [])
        },
        {
          key: `${sourceId}:hot`,
          url: requestUrl("/api/public/hot-topics"),
          map: (data) =>
            Array.isArray(data.items) ? data.items.map((item) => normalizeHotTopic(item, sourceId, sourceName)) : []
        },
        {
          key: `${sourceId}:daily`,
          url: requestUrl("/api/public/daily"),
          map: (data) => {
            const daily = normalizeDaily(data, sourceId, sourceName);
            return daily ? [daily] : [];
          }
        }
      ];

      const items = [];
      const etags = {};

      for (const query of queries) {
        try {
          const result = await fetchJson(query.url, context.etags[query.key]);
          if (result.etag) etags[query.key] = result.etag;
          if (result.status !== 304 && result.data) {
            items.push(...query.map(result.data));
          }
        } catch (error) {
          context.log(`AIHOT sync skipped ${query.key}: ${error.message}`);
        }
      }

      return { items, etags };
    }
  };
}

module.exports = {
  createAihotAdapter
};
