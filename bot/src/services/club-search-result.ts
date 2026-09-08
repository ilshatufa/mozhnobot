import { ClubSearchRequestStatus, type ClubSearchRequest } from "@prisma/client";

const MAX_SEARCH_RESULT_LENGTH = 4_096;
const MAX_SOURCE_PREVIEW_LENGTH = 220;
const SOURCE_LIMIT = 8;

export type ClubSearchSourceMessage = {
  telegramMessageId: number;
  text: string | null;
  caption: string | null;
};

function escapeMarkdown(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#+\-.!|~]/g, "\\$&");
}

function sourceLink(clubGroupId: string, messageId: number): string {
  const internalChatId = clubGroupId.replace(/^-100/, "");
  return `https://t.me/c/${internalChatId}/${messageId}`;
}

function truncatePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const characters = [...normalized];
  if (characters.length <= MAX_SOURCE_PREVIEW_LENGTH) return normalized;
  return `${characters.slice(0, MAX_SOURCE_PREVIEW_LENGTH - 1).join("")}…`;
}

function formatParagraph(text: string): string {
  return text.split("\n").map(escapeMarkdown).join("  \n");
}

function formatAnswer(answer: string): string {
  const blocks = answer.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const markdown: string[] = [];
  let relatedSectionOpen = false;

  for (const block of blocks) {
    if (block === "Точно проходили:") {
      markdown.push("## Точно проходили");
      continue;
    }
    if (block === "Связаны с темой:") {
      markdown.push("<details><summary>Связаны с темой</summary>");
      relatedSectionOpen = true;
      continue;
    }
    markdown.push(formatParagraph(block));
  }

  if (relatedSectionOpen) markdown.push("</details>");
  return markdown.join("\n\n");
}

function buildScreen(question: string, content: string): string {
  return [
    "# Ответ из истории клуба",
    question.split("\n").map((line) => `> ${escapeMarkdown(line)}`).join("\n"),
    content,
  ].join("\n\n");
}

export function buildSearchResultRichMarkdown(
  request: Pick<ClubSearchRequest, "status" | "question" | "answer" | "sourceMessageIds">,
  sourceMessages: ClubSearchSourceMessage[],
  clubGroupId: string,
): string {
  if (request.status === ClubSearchRequestStatus.FAILED) {
    return buildScreen(
      request.question,
      formatParagraph("Сейчас поиск недоступен. Попробуйте ещё раз позже."),
    );
  }

  const answer = request.answer?.trim();
  if (!answer) {
    return buildScreen(
      request.question,
      formatParagraph("По истории клуба не нашлось достаточно данных для ответа. Попробуйте добавить тему, имя или конкретный пример."),
    );
  }

  const uniqueSourceIds = [...new Set(request.sourceMessageIds)].slice(0, SOURCE_LIMIT);
  if (uniqueSourceIds.length === 0) {
    return buildScreen(request.question, formatAnswer(answer.slice(0, MAX_SEARCH_RESULT_LENGTH)));
  }

  const messageById = new Map(sourceMessages.map((message) => [message.telegramMessageId, message]));
  const sourceBlocks = uniqueSourceIds.map((messageId, index) => {
    const message = messageById.get(messageId);
    const preview = truncatePreview(message?.text ?? message?.caption ?? "");
    const linkLabel = `Открыть сообщение ${index + 1}`;
    const link = `[${linkLabel}](${sourceLink(clubGroupId, messageId)})`;
    return {
      markdown: preview
        ? `${preview.split("\n").map((line) => `> ${escapeMarkdown(line)}`).join("\n")}\n\n${link}`
        : link,
      visible: preview ? `${preview}\n${linkLabel}` : linkLabel,
    };
  });

  const sourceVisibleText = ["Сообщения из клуба", ...sourceBlocks.map((block) => block.visible)].join("\n\n");
  const sourceMarkdown = ["## Сообщения из клуба", ...sourceBlocks.map((block) => block.markdown)].join("\n\n");
  const fixedVisibleLength = request.question.length + sourceVisibleText.length + 24;
  const answerLimit = Math.max(0, MAX_SEARCH_RESULT_LENGTH - fixedVisibleLength);

  return buildScreen(request.question, `${formatAnswer(answer.slice(0, answerLimit))}\n\n${sourceMarkdown}`);
}
