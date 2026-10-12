import { channels, veraError } from "@vera/shared";

/** The caller supplies the user's confirmation; OAuth's Sign in click authorizes its auth page. */
export async function openExternal(
  request: { url: string; confirmed: true },
  open: (url: string) => Promise<void>,
  oauth = false,
): Promise<Record<string, never>> {
  const parsed = channels["app.openExternal"].request.safeParse(request);
  if (!parsed.success) throw veraError("INVALID");
  const url = new URL(parsed.data.url);
  if (
    url.username ||
    url.password ||
    (oauth &&
      (url.protocol !== "https:" ||
        url.hostname !== "auth.openai.com" ||
        url.port ||
        url.pathname !== "/api/accounts/authorize"))
  )
    throw veraError("DENIED");
  await open(url.href);
  return {};
}
