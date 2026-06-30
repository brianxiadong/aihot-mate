const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const sanitizeHtml = require("sanitize-html");

const READER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-mate/0.1.0";

const ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
  "article",
  "aside",
  "figure",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "img",
  "picture",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "ul",
  "ol",
  "li",
  "tr",
  "th",
  "td"
]);

const ALLOWED_ATTRIBUTES = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: ["href", "name", "target", "rel"],
  img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
  code: ["class"],
  pre: ["class"],
  table: ["class"],
  th: ["align"],
  td: ["align"]
};

async function extractReadableArticle(url) {
  if (!url) {
    throw new Error("Missing article URL.");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": READER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`Article fetch failed with ${response.status}.`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const aihotArticle = parseAihotItemArticle(dom, url);
  if (aihotArticle) {
    return aihotArticle;
  }

  const parsed = new Readability(dom.window.document).parse();

  if (!parsed || !parsed.content) {
    throw new Error("Readable article extraction returned empty content.");
  }

  const content = sanitizeHtml(parsed.content, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer noopener" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" })
    }
  });

  return {
    title: parsed.title || "",
    byline: parsed.byline || "",
    excerpt: parsed.excerpt || "",
    siteName: parsed.siteName || "",
    content,
    sourceUrl: url,
    fetchedAt: new Date().toISOString()
  };
}

function parseAihotItemArticle(dom, url) {
  if (!isAihotItemUrl(url)) return null;
  const document = dom.window.document;
  const jsonLd = parseNewsArticleJsonLd(document);
  const title =
    jsonLd?.headline ||
    contentOf(document, 'meta[property="og:title"]') ||
    textOf(document, ".dt-detail h1, .m-detail h1") ||
    document.title.replace(/\s*·\s*AI HOT\s*$/i, "");
  const summary =
    textOf(document, ".m-detail-summary-text") ||
    textOf(document, ".dt-summary-text") ||
    jsonLd?.description ||
    contentOf(document, 'meta[name="description"]');
  const paragraphs = uniqueText(
    Array.from(document.querySelectorAll(".m-detail-tweet .m-detail-p, .dt-tweet .dt-p")).map((node) => node.textContent)
  );
  const relatedRows = uniqueBy(
    Array.from(document.querySelectorAll(".m-detail-related-row, .dt-related-row"))
      .map((row) => {
        const href = row.getAttribute("href");
        const titleText = textOf(row, ".m-detail-related-row-title, .dt-related-row-title");
        const source = textOf(row, ".m-detail-related-src, .dt-related-src");
        return titleText
          ? {
              title: titleText,
              source,
              href: href ? absoluteUrl(url, href) : ""
            }
          : null;
      })
      .filter(Boolean),
    (row) => `${row.title}|${row.source}`
  ).slice(0, 8);
  const images = uniqueBy(
    Array.from(document.querySelectorAll(".x-tweet-media-img"))
      .map((image) => {
        const src = image.getAttribute("src");
        return src
          ? {
              src: absoluteUrl(url, src),
              alt: image.getAttribute("alt") || ""
            }
          : null;
      })
      .filter(Boolean),
    (image) => image.src
  ).slice(0, 6);

  if (!summary && paragraphs.length === 0) return null;

  const parts = [];
  if (summary) {
    parts.push("<h2>AI 摘要</h2>");
    parts.push(`<p>${escapeHtml(summary)}</p>`);
  }
  if (paragraphs.length > 0) {
    parts.push("<h2>AI 翻译 / 原文</h2>");
    paragraphs.forEach((paragraph) => {
      parts.push(`<p>${linkifyText(paragraph, url)}</p>`);
    });
  }
  if (images.length > 0) {
    parts.push("<h2>配图</h2>");
    images.forEach((image) => {
      parts.push(`<figure><img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt)}"/></figure>`);
    });
  }
  if (relatedRows.length > 0) {
    parts.push("<h2>同一事件的相关报道</h2>");
    parts.push("<ul>");
    relatedRows.forEach((row) => {
      const label = row.source ? `${row.title} - ${row.source}` : row.title;
      parts.push(
        row.href
          ? `<li><a href="${escapeAttribute(row.href)}">${escapeHtml(label)}</a></li>`
          : `<li>${escapeHtml(label)}</li>`
      );
    });
    parts.push("</ul>");
  }

  const content = sanitizeContent(parts.join("\n"));
  return {
    title: title || "",
    byline: textOf(document, ".m-detail-source-name, .dt-source-name") || "AI HOT",
    excerpt: summary || "",
    siteName: "AI HOT",
    content,
    sourceUrl: url,
    fetchedAt: new Date().toISOString()
  };
}

function parseNewsArticleJsonLd(document) {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const data = parseJson(script.textContent);
    const article = findNewsArticle(data);
    if (article) return article;
  }
  return null;
}

function findNewsArticle(value) {
  if (!value || typeof value !== "object") return null;
  if (value["@type"] === "NewsArticle") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findNewsArticle(entry);
      if (found) return found;
    }
  }
  if (Array.isArray(value["@graph"])) {
    return findNewsArticle(value["@graph"]);
  }
  return null;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "");
  } catch {
    return null;
  }
}

function isAihotItemUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "aihot.virxact.com" && parsed.pathname.startsWith("/items/");
  } catch {
    return false;
  }
}

function textOf(root, selector) {
  const node = typeof root.querySelector === "function" ? root.querySelector(selector) : null;
  return normalizeText(node?.textContent || "");
}

function contentOf(document, selector) {
  return normalizeText(document.querySelector(selector)?.getAttribute("content") || "");
}

function uniqueText(values) {
  return uniqueBy(
    values
      .map((value) => normalizeText(value || ""))
      .filter(Boolean),
    (value) => value
  );
}

function uniqueBy(values, keyOf) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyOf(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function absoluteUrl(baseUrl, value) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function linkifyText(value, baseUrl) {
  const escaped = escapeHtml(value);
  return escaped.replace(/https?:\/\/[^\s<]+/g, (match) => {
    const href = absoluteUrl(baseUrl, match);
    return `<a href="${escapeAttribute(href)}">${escapeHtml(match)}</a>`;
  });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function sanitizeContent(content) {
  return sanitizeHtml(content, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer noopener" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" })
    }
  });
}

module.exports = {
  extractReadableArticle,
  isAihotItemUrl,
  sanitizeContent
};
