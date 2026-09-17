import { readFile } from "node:fs/promises";
import process from "node:process";

const API_BASE = "https://api.telegra.ph";

function inlineChildren(text) {
  const children = [];
  const linkPattern = /\[([^\]]+)]\((https?:\/\/[^)]+)\)/g;
  let offset = 0;

  for (const match of text.matchAll(linkPattern)) {
    if (match.index > offset) children.push(text.slice(offset, match.index));
    children.push({ tag: "a", attrs: { href: match[2] }, children: [match[1]] });
    offset = match.index + match[0].length;
  }

  if (offset < text.length) children.push(text.slice(offset));
  return children.length > 0 ? children : [text];
}

function markdownToNodes(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const nodes = [];
  let paragraph = [];
  let listItems = [];
  let titleSkipped = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    nodes.push({ tag: "p", children: inlineChildren(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    nodes.push({
      tag: "ul",
      children: listItems.map((item) => ({ tag: "li", children: inlineChildren(item) })),
    });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("# ") && !titleSkipped) {
      flushParagraph();
      flushList();
      titleSkipped = true;
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      nodes.push({ tag: "h3", children: [line.slice(3)] });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return nodes;
}

async function telegraph(method, fields) {
  const response = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  if (!response.ok) throw new Error(`Telegraph ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(`Telegraph ${method}: ${payload.error ?? "unknown error"}`);
  return payload.result;
}

async function loadToken(path) {
  const envFile = await readFile(path, "utf8");
  const line = envFile.split(/\r?\n/).find((item) => item.startsWith("TELEGRAPH_ACCESS_TOKEN="));
  if (!line) throw new Error("TELEGRAPH_ACCESS_TOKEN is missing in TELEGRAPH_TOKEN_FILE");
  return line.slice("TELEGRAPH_ACCESS_TOKEN=".length).trim();
}

const sourcePath = process.argv[2];
const tokenFile = process.env.TELEGRAPH_TOKEN_FILE;
if (!sourcePath || !tokenFile) {
  throw new Error("Usage: TELEGRAPH_TOKEN_FILE=/path/.env node publish-telegraph-markdown.mjs <source.md>");
}

const markdown = await readFile(sourcePath, "utf8");
const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
if (!title) throw new Error("The source must start with a level-one title");
const termsVersion = markdown.match(/^Версия:\s*(\S+)$/m)?.[1]?.trim();
if (!termsVersion) throw new Error("The source must contain a terms version");

const content = JSON.stringify(markdownToNodes(markdown));
if (Buffer.byteLength(content, "utf8") > 64 * 1024) {
  throw new Error("Telegraph content exceeds 64 KB");
}

const accessToken = await loadToken(tokenFile);
const pagePath = process.env.TELEGRAPH_PAGE_PATH?.trim();
const fields = {
  access_token: accessToken,
  title,
  author_name: process.env.TELEGRAPH_AUTHOR_NAME?.trim() || "МОЖНО VPN",
  content,
  return_content: "true",
};
const result = pagePath
  ? await telegraph("editPage", { ...fields, path: pagePath })
  : await telegraph("createPage", fields);

const published = await telegraph("getPage", { path: result.path, return_content: "true" });
const publishedText = JSON.stringify(published.content ?? []);
for (const marker of [termsVersion, "100 Telegram Stars", "Поддержка по оплате"]) {
  if (!publishedText.includes(marker)) throw new Error(`Published page is missing marker: ${marker}`);
}

console.log(result.url);
