import { ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import type { BrandLink } from "../../lib/brandGuides";

export async function openUrl(url: string) {
  try {
    const { openUrl: o } = await import("@tauri-apps/plugin-opener");
    await o(url);
  } catch {
    /* ignore */
  }
}

/** One full-width button per official link. */
export function LinkButtons({ links }: { links: BrandLink[] }) {
  return (
    <>
      {links.map((l) => (
        <Button key={l.url} size="block" onClick={() => openUrl(l.url)}>
          <ExternalLink size={13} /> {l.label}
        </Button>
      ))}
    </>
  );
}
