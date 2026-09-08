import { ClubSearchRequestStatus, type ClubSearchRequest } from "@prisma/client";

const MAX_TELEGRAM_TEXT_LENGTH = 4_096;
const MAX_SOURCE_PREVIEW_LENGTH = 220;
const SOURCE_LIMIT = 8;
const SECTION_SPACER = "\u2800";

export type ClubSearchSourceMessage = {
  telegramMessageId: number;
  text: string | null;
  caption: string | null;
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

function formatAnswer(answer: string): string {
  return answer
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "Точно проходили:" || trimmed === "Связаны с темой:") {
        return `<b>${escapeHtml(trimmed.slice(0, -1))}</b>`;
      }
      return escapeHtml(line);
    })
    .join("\n");
}

export function buildSearchResultText(
  request: Pick<ClubSearchRequest, "status" | "answer" | "sourceMessageIds">,
  sourceMessages: ClubSearchSourceMessage[],
  clubGroupId: string,
): string {
  if (request.status === ClubSearchRequestStatus.FAILED) {
    return "Сейчас поиск недоступен. Попробуйте ещё раз позже.";
  }

  const answer = request.answer?.trim();
  if (!answer) {
    return "По истории клуба не нашлось достаточно данных для ответа. Попробуйте добавить тему, имя или конкретный пример.";
  }

  const uniqueSourceIds = [...new Set(request.sourceMessageIds)].slice(0, SOURCE_LIMIT);
  if (uniqueSourceIds.length === 0) {
    return formatAnswer(answer.slice(0, MAX_TELEGRAM_TEXT_LENGTH));
  }

  const messageById = new Map(sourceMessages.map((message) => [message.telegramMessageId, message]));
  const sourceBlocks = uniqueSourceIds.map((messageId, index) => {
    const message = messageById.get(messageId);
    const preview = truncatePreview(message?.text ?? message?.caption ?? "");
    const linkLabel = `Открыть сообщение ${index + 1}`;
    const link = `<a href="${sourceLink(clubGroupId, messageId)}">${linkLabel}</a>`;
    return {
      html: preview ? `<blockquote expandable>${escapeHtml(preview)}</blockquote>\n${link}` : link,
      visible: preview ? `${preview}\n${linkLabel}` : linkLabel,
    };
  });

  const sourceVisibleText = [SECTION_SPACER, "Сообщения из клуба", ...sourceBlocks.map((block) => block.visible)]
    .join("\n\n");
  const sourceHtml = [SECTION_SPACER, "<b>Сообщения из клуба</b>", ...sourceBlocks.map((block) => block.html)]
    .join("\n\n");
  const answerLimit = Math.max(0, MAX_TELEGRAM_TEXT_LENGTH - sourceVisibleText.length - 2);

  return `${formatAnswer(answer.slice(0, answerLimit))}\n\n${sourceHtml}`;
}
