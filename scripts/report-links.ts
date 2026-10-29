/** Allow only absolute HTTP(S) candidate links; HTML-escape the result at the call site. */
export function candidateHref(value: string | null | undefined): string {
  if (!value || !/^https?:\/\//i.test(value)) return "#";
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? value : "#";
  } catch {
    return "#";
  }
}
