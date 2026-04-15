export type TelegramResult =
  | { ok: true; messageId: number }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

export async function sendTelegram(text: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const chatId = process.env.TELEGRAM_PROBE_CHAT_ID ?? "";

  if (!token || !chatId) {
    return { ok: false, skipped: true, reason: "missing config" };
  }

  const result = await trySend(token, chatId, text);
  if (result.ok) return result;

  const fallbackToken = process.env.TELEGRAM_FALLBACK_BOT_TOKEN ?? "";
  if (fallbackToken) {
    return trySend(fallbackToken, chatId, text);
  }

  return result;
}

async function trySend(
  token: string,
  chatId: string,
  text: string
): Promise<TelegramResult> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const desc = (body as { description?: string }).description ?? "";
      return { ok: false, error: `${res.status}: ${desc}`.trim() };
    }

    const body = await res.json();
    return {
      ok: true,
      messageId: (body as { result: { message_id: number } }).result
        .message_id,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
