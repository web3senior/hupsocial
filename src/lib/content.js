export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ContentType = Object.freeze({
  Post: 0,
  Comment: 1,
  Repost: 2,
});

export const ElementType = Object.freeze({
  Text: "text",
  Media: "media",
});

export function textElement(text = "") {
  return {
    type: ElementType.Text,
    data: { text },
  };
}

export function mediaElement(items = []) {
  return {
    type: ElementType.Media,
    data: { items },
  };
}

export function makeMetadata({ text = "", mediaItems = [], quoteOf } = {}) {
  const metadata = {
    version: "1",
    elements: [
      textElement(text),
      mediaElement(mediaItems),
    ],
  };

  if (quoteOf !== undefined && quoteOf !== null) {
    metadata.quoteOf = quoteOf.toString();
  }

  return JSON.stringify(metadata);
}

export function parseMetadata(metadata) {
  try {
    return JSON.parse(metadata || "{}");
  } catch {
    return { version: "1", elements: [] };
  }
}

export function getText(metadata) {
  const parsed = typeof metadata === "string" ? parseMetadata(metadata) : metadata;

  const textItem = parsed.elements?.find((item) => item.type === ElementType.Text);
  return textItem?.data?.text || "";
}

export function getMediaItems(metadata) {
  const parsed = typeof metadata === "string" ? parseMetadata(metadata) : metadata;

  const mediaItem = parsed.elements?.find((item) => item.type === ElementType.Media);
  return mediaItem?.data?.items || [];
}

// A thread rides in its first post's content: `parts` holds parts 2…N as { elements }, so the
// whole thread is one pin and one transaction. Bounded so the pinned JSON stays a sane size.
export const MAX_THREAD_PARTS = 25;

export function getThreadParts(content) {
  return Array.isArray(content?.parts) ? content.parts.slice(0, MAX_THREAD_PARTS - 1) : [];
}

export function isQuotePost(content) {
  const metadata = parseMetadata(content.metadata);

  return (
    Number(content.cType) === ContentType.Post &&
    metadata.quoteOf !== undefined &&
    metadata.quoteOf !== null
  );
}