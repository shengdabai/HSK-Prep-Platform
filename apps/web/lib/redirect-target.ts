export function safeRedirectPath(target: string | null): string {
  const next = target ?? "/account";
  // Browsers normalize backslashes and strip tabs/newlines before resolving URLs.
  const unsafeCharacter = [...next].some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || code < 32 || code === 127;
  });
  return next.startsWith("/") && !next.startsWith("//") && !unsafeCharacter
    ? next
    : "/account";
}
