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

module.exports = {
  extractReadableArticle
};
