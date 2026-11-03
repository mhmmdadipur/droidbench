import { Scale } from "lucide-react";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { useI18n } from "../i18n";

const ACK_KEY = "droidbench.terms.ack.v1";

/** Has the user already acknowledged the terms/notices? */
export function hasAcceptedTerms(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
}
function setAccepted() {
  try {
    localStorage.setItem(ACK_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Bundled third-party apps shown in the notices. Keep in sync with
 * src-tauri/licenses/THIRD-PARTY-LICENSES.txt and the bundled APKs. */
const BUNDLED = [
  {
    name: "InjuredPixels for Android",
    author: "Aurelitec",
    license: "Apache License 2.0",
    url: "https://github.com/aurelitec/injuredpixels-android",
  },
  {
    name: "Hardware Testing",
    author: "Rohan Agarwal",
    license: "MIT License",
    url: "https://github.com/rohanagarwal94/Hardware-testing",
  },
  {
    name: "scrcpy / scrcpy-server",
    author: "Genymobile",
    license: "Apache License 2.0",
    url: "https://github.com/Genymobile/scrcpy",
  },
  {
    name: "libimobiledevice (iOS tools)",
    author: "libimobiledevice project",
    license: "LGPL-2.1",
    url: "https://github.com/libimobiledevice/libimobiledevice",
  },
  {
    name: "go-ios (iOS mirror)",
    author: "Daniel Paulus",
    license: "MIT License",
    url: "https://github.com/danielpaulus/go-ios",
  },
  {
    name: "adb, fastboot",
    author: "Android Open Source Project",
    license: "Apache License 2.0",
    url: "https://source.android.com/",
  },
];

async function openExternal(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    /* ignore */
  }
}

/**
 * Terms & third-party license notices.
 *
 * - `mode="firstRun"` shows the acknowledgment popup once (gated by a button);
 *   closing is only possible via Accept.
 * - `mode="info"` is the same content opened on demand, dismissable anytime.
 */
export function LicenseModal({
  mode,
  onClose,
}: {
  mode: "firstRun" | "info";
  onClose: () => void;
}) {
  const { t } = useI18n();

  function accept() {
    setAccepted();
    onClose();
  }

  const footer =
    mode === "firstRun" ? (
      <>
        <span className="flex-1 text-[11px] text-[var(--color-ink-faint)]">{t("terms.ackHint")}</span>
        <Button variant="primary" size="sm" onClick={accept}>
          {t("terms.accept")}
        </Button>
      </>
    ) : (
      <Button variant="default" size="sm" className="ml-auto" onClick={onClose}>
        {t("common.close")}
      </Button>
    );

  return (
    <Modal
      icon={Scale}
      title={t("terms.title")}
      dismissable={mode === "info"}
      onClose={onClose}
      footer={footer}
    >
      <div className="space-y-3 text-[12px] leading-relaxed text-[var(--color-ink-soft)]">
        <p>{t("terms.intro")}</p>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            {t("terms.bundledTitle")}
          </div>
          <p className="mb-2 text-[11.5px]">{t("terms.bundledIntro")}</p>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {BUNDLED.map((b, i) => (
              <div
                key={b.name}
                className={`flex items-start gap-2 px-3 py-2 ${i % 2 ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface)]"}`}
              >
                <span className="min-w-0 flex-1">
                  <button
                    onClick={() => openExternal(b.url)}
                    className="no-drag block text-left text-[12px] font-medium text-[var(--color-brand-600)] hover:underline"
                  >
                    {b.name}
                  </button>
                  <span className="block text-[11px] text-[var(--color-ink-faint)]">
                    {b.author} · {b.license}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11.5px]">{t("terms.disclaimer")}</p>
        <p className="text-[11px] text-[var(--color-ink-faint)]">{t("terms.noticeFile")}</p>
      </div>
    </Modal>
  );
}
