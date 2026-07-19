import {
  normalizeOfficialSchoolUrl,
  officialSchoolRequestHeaders,
  OfficialSchoolSourceError
} from "./official-school-calendar";

const MAX_SUPPLY_HTML_BYTES = 1_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface OfficialSupplyItem {
  id: string;
  text: string;
  quantity: number | null;
  sourceOrdinal: number;
  kind: "item" | "group_label" | "separator";
}

export interface OfficialSupplyList {
  provider: "school_supplies";
  title: string;
  sourceUrl: string;
  sourceTitle: string;
  items: OfficialSupplyItem[];
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"'
  };
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const numeric = code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
      }
      return named[code.toLowerCase()] ?? entity;
    })
    .replace(/[\t\r ]+/g, " ")
    .trim();
}

async function stableId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function titleFrom(html: string): string {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ?? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeHtml(match?.[1] ?? "Official school supply list");
  return title.slice(0, 200) || "Official school supply list";
}

function itemKind(text: string): OfficialSupplyItem["kind"] {
  if (/^or$/i.test(text.trim())) return "separator";
  if (/^(one of|choose|select)\b.*:\s*$/i.test(text.trim())) return "group_label";
  return "item";
}

export function parseOfficialSupplyList(html: string, sourceUrl: string): OfficialSupplyList {
  const marker = html.search(/class=(?:"[^"]*\bpage-block-text\b[^"]*"|'[^']*\bpage-block-text\b[^']*')/i);
  if (marker < 0) throw new OfficialSchoolSourceError("The official page does not contain a published supply list.");
  const content = html.slice(marker);
  const lines = [...content.matchAll(/<div\b[^>]*class=(?:"[^"]*\bplaceholder-tinymce-text\b[^"]*"|'[^']*\bplaceholder-tinymce-text\b[^']*')[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => decodeHtml(match[1] ?? "").replace(/^[-–—]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 250);
  if (lines.length === 0) throw new OfficialSchoolSourceError("The official page does not contain readable supply items.");
  const title = titleFrom(html);
  return {
    provider: "school_supplies",
    title,
    sourceUrl,
    sourceTitle: title,
    items: lines.map((text, index) => ({
      id: `pending-${index}`,
      text: text.slice(0, 500),
      quantity: null,
      sourceOrdinal: index + 1,
      kind: itemKind(text)
    }))
  };
}

export class OfficialSupplyListAdapter {
  private readonly fetcher: typeof fetch;

  constructor(input: { fetcher?: typeof fetch } = {}) {
    this.fetcher = input.fetcher ?? fetch;
  }

  async sync(rawUrl: string): Promise<OfficialSupplyList> {
    let current = normalizeOfficialSchoolUrl(rawUrl);
    for (let redirect = 0; redirect < 4; redirect += 1) {
      const response = await this.fetcher(current, {
        method: "GET",
        redirect: "manual",
        headers: officialSchoolRequestHeaders()
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new OfficialSchoolSourceError("The official source redirect is invalid.");
        current = normalizeOfficialSchoolUrl(location, current);
        continue;
      }
      if (!response.ok) throw new OfficialSchoolSourceError("The official supply list could not be read.");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_SUPPLY_HTML_BYTES) {
        throw new OfficialSchoolSourceError("The official supply page is too large.");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new OfficialSchoolSourceError("The official supply source did not return an HTML page.");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_SUPPLY_HTML_BYTES) throw new OfficialSchoolSourceError("The official supply page is too large.");
      const list = parseOfficialSupplyList(new TextDecoder().decode(bytes), current);
      return {
        ...list,
        items: await Promise.all(list.items.map(async (item) => ({
          ...item,
          id: `supply-${(await stableId(`${current}|${item.sourceOrdinal}|${item.text}`)).slice(0, 32)}`
        })))
      };
    }
    throw new OfficialSchoolSourceError("The official supply source redirected too many times.");
  }
}
