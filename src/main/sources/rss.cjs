const { XMLParser } = require("fast-xml-parser");
const sanitizeHtml = require("sanitize-html");
const { normalizeText, toIsoDate } = require("./types.cjs");

const RSS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-mate/0.1.0";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata"
});

async function fetchText(url, etag) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": RSS_UA,
      Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.8",
      ...(etag ? { "If-None-Match": etag } : {})
    }
  });

  const nextEtag = response.headers.get("etag");
  if (response.status === 304) {
    return { status: 304, etag: nextEtag || etag, text: null };
  }

  if (!response.ok) {
    throw new Error(`RSS request failed with ${response.status}: ${url}`);
  }

  return { status: response.status, etag: nextEtag, text: await response.text() };
}

function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return normalizeText(value.__cdata || value["#text"] || "");
  return "";
}

function hrefOf(link) {
  if (!link) return "";
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alternate = link.find((entry) => entry && (entry["@_rel"] === "alternate" || !entry["@_rel"]));
    return hrefOf(alternate || link[0]);
  }
  return link["@_href"] || link["#text"] || "";
}

function stableId(sourceId, link, title, date) {
  const input = `${sourceId}:${link}:${title}:${date}`;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return `${sourceId}:rss:${hash.toString(36)}`;
}

function normalizeRssItem(entry, source) {
  const title = textOf(entry.title) || "未命名 RSS 条目";
  const link = hrefOf(entry.link) || textOf(entry.guid) || source.feedUrl;
  const publishedAt = toIsoDate(entry.pubDate || entry.published || entry.updated || entry["dc:date"]);
  const summaryHtml = entry["content:encoded"] || entry.content || entry.summary || entry.description || "";
  const summaryText = sanitizeHtml(textOf(summaryHtml), { allowedTags: [], allowedAttributes: {} });

  return {
    id: stableId(source.id, link, title, publishedAt),
    externalId: textOf(entry.guid || entry.id) || link,
    sourceId: source.id,
    sourceName: source.name,
    channel: source.name,
    title,
    summary: normalizeText(summaryText).slice(0, 420),
    url: link,
    originalUrl: link,
    readerUrl: link,
    publishedAt,
    category: source.category || "rss",
    score: null,
    selected: false,
    kind: "rss",
    badges: ["RSS"],
    embeddedArticle: summaryHtml
      ? {
          title,
          byline: source.name,
          excerpt: normalizeText(summaryText).slice(0, 240),
          siteName: source.name,
          content: sanitizeHtml(textOf(summaryHtml), {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption", "pre", "code"]),
            allowedAttributes: {
              a: ["href", "target", "rel"],
              img: ["src", "alt", "title", "width", "height", "loading"]
            }
          }),
          sourceUrl: link,
          fetchedAt: new Date().toISOString()
        }
      : null,
    raw: entry
  };
}

function parseFeed(xml, source) {
  const data = parser.parse(xml);
  if (data.rss && data.rss.channel) {
    return arrayify(data.rss.channel.item).map((item) => normalizeRssItem(item, source));
  }

  if (data.feed) {
    return arrayify(data.feed.entry).map((entry) => normalizeRssItem(entry, source));
  }

  return [];
}

function createRssAdapter(source) {
  return {
    id: source.id,
    name: source.name,
    type: "rss",
    async sync(context) {
      if (!source.feedUrl) {
        return { items: [], etags: {} };
      }

      const key = `${source.id}:rss`;
      const result = await fetchText(source.feedUrl, context.etags[key]);
      const etags = {};
      if (result.etag) etags[key] = result.etag;
      if (result.status === 304 || !result.text) {
        return { items: [], etags };
      }

      return {
        items: parseFeed(result.text, source),
        etags
      };
    }
  };
}

module.exports = {
  createRssAdapter
};
