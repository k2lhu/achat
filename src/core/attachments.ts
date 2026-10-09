// Turns attachments into what each API expects. Text files (and PDFs, for APIs
// without native PDF support) are placed in the message as tagged text.

import type { Attachment, ChatMessage } from './types.js';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** The message text with text files (and PDFs unless sent natively) placed before it. */
export function textWithFiles(message: ChatMessage, nativePdf: boolean): string {
  const files = (message.attachments ?? []).filter(
    (a): a is Extract<Attachment, { kind: 'text' | 'pdf' }> => a.kind === 'text' || (a.kind === 'pdf' && !nativePdf),
  );
  const blocks = files.map((file) => {
    const body = file.text.trim() || '(no extractable text)';
    return `<file name="${file.name}">\n${body}\n</file>`;
  });
  return [...blocks, message.content].join('\n\n');
}

export function imagesOf(message: ChatMessage) {
  return (message.attachments ?? []).filter((a): a is Extract<Attachment, { kind: 'image' }> => a.kind === 'image');
}

export function pdfsOf(message: ChatMessage) {
  return (message.attachments ?? []).filter((a): a is Extract<Attachment, { kind: 'pdf' }> => a.kind === 'pdf');
}

/** Chat Completions message: plain text, or text plus images as data URLs. */
export function toOpenAIMessage(message: ChatMessage) {
  if (!message.attachments?.length) return { role: message.role, content: message.content };
  const text = textWithFiles(message, false);
  const images = imagesOf(message);
  if (images.length === 0) return { role: message.role, content: text };
  return {
    role: message.role,
    content: [
      { type: 'text' as const, text },
      ...images.map((image) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      })),
    ],
  };
}
