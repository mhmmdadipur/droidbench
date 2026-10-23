// App auto-update via Tauri updater plugin. Checks the GitHub Releases
// latest.json endpoint; if a newer signed version exists, downloads & installs
// it, then restarts.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  notes?: string;
}

/** Returns update info if a newer version is available, else null. */
export async function checkForUpdate(): Promise<(UpdateInfo & { _handle: Update }) | null> {
  try {
    const update = await check();
    if (update) {
      return { version: update.version, notes: update.body, _handle: update };
    }
    return null;
  } catch (e) {
    console.warn("update check failed:", e);
    return null;
  }
}

/** Download + install a pending update, reporting progress, then relaunch. */
export async function installUpdate(
  handle: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await handle.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, total);
        break;
      case "Finished":
        onProgress?.(total ?? downloaded, total);
        break;
    }
  });
  await relaunch();
}
