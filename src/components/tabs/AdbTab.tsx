import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Camera, Video, Square, Contact, Wifi, Loader2, ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useI18n } from "../../i18n";
import { runCapture, iosScreenshot } from "../../lib/api";

export function AdbTab() {
  const t = useTools();
  const { push, run, cancel } = useLog();
  const { device } = useDevice();
  const { t: tr } = useI18n();
  const [recording, setRecording] = useState(false);
  const [recDevPath, setRecDevPath] = useState("");
  const [recDest, setRecDest] = useState("");
  const [wifiIp, setWifiIp] = useState("");
  const [url, setUrl] = useState("");
  const [typeText, setTypeText] = useState("");

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push(tr("adb.mirrorNeeds"), "stderr");
      return false;
    }
    return true;
  }

  function sendText() {
    const tx = typeText.trim();
    if (!tx) return;
    // adb input text uses %s for spaces
    t.adb(["shell", "input", "text", tx.replace(/ /g, "%s")]);
    setTypeText("");
  }

  async function takeScreenshot() {
    if (!guard()) return;
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") {
      push(tr("adb.noFolder"), "stderr");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const devPath = `/sdcard/droidbench-${stamp}.png`;
    const dest = `${dir}/droidbench-${stamp}.png`;
    push(tr("adb.saving", { path: dest }), "system");
    try {
      await runCapture("adb", ["shell", "screencap", "-p", devPath]);
      run("adb", ["pull", devPath, dest]);
      setTimeout(() => runCapture("adb", ["shell", "rm", devPath]).catch(() => {}), 1500);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function startRecording() {
    if (!guard()) return;
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") {
      push(tr("adb.noFolder"), "stderr");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const devPath = `/sdcard/droidbench-${stamp}.mp4`;
    const dest = `${dir}/droidbench-${stamp}.mp4`;
    setRecDevPath(devPath);
    setRecDest(dest);
    setRecording(true);
    push(tr("adb.recording"), "system");
    // screenrecord stops on its own after 180s or when we cancel the command
    run("adb", ["shell", "screenrecord", "--time-limit", "180", devPath]);
  }

  async function stopRecording() {
    cancel(); // sends SIGINT-equivalent kill → screenrecord finalizes the mp4
    setRecording(false);
    push(tr("adb.saving", { path: recDest }), "system");
    // give the device a moment to finalize the file, then pull + cleanup
    setTimeout(() => {
      run("adb", ["pull", recDevPath, recDest]);
      setTimeout(() => runCapture("adb", ["shell", "rm", recDevPath]).catch(() => {}), 2000);
    }, 1200);
  }

  async function backupContacts() {
    if (!guard()) return;
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") {
      push(tr("adb.noFolder"), "stderr");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const devPath = `/sdcard/droidbench-contacts-${stamp}.txt`;
    const dest = `${dir}/contacts-${stamp}.txt`;
    push(tr("adb.saving", { path: dest }), "system");
    try {
      // write the query output to a device file, then pull it (adb writes to
      // the host fs directly — no Tauri fs-scope issues).
      await runCapture("adb", [
        "shell",
        `content query --uri content://contacts/phones --projection display_name:number > ${devPath}`,
      ]);
      run("adb", ["pull", devPath, dest]);
      setTimeout(() => runCapture("adb", ["shell", "rm", devPath]).catch(() => {}), 1500);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function enterSideload() {
    if (!device.connected) {
      push(tr("adb.noDevice"), "stderr");
      return;
    }
    push(tr("adb.sideloadReboot"), "system");
    t.adb(["reboot", "sideload"]);
  }

  async function sideloadFile() {
    const file = await open({
      multiple: false,
      filters: [{ name: "OTA ZIP", extensions: ["zip"] }],
    });
    if (typeof file !== "string") return;
    push(tr("adb.sideloadStart"), "system");
    push(`Sideloading: ${file}`, "system");
    t.adb(["sideload", file]);
  }

  function startMirroring() {
    if (!device.connected || device.mode !== "adb") {
      push(tr("adb.mirrorNeeds"), "stderr");
      return;
    }
    push(tr("adb.mirrorOpening"), "system");
    const win = new WebviewWindow("mirror", {
      url: "index.html?view=mirror",
      title: "Droidbench Mirror",
      width: 680,
      height: 900,
      minWidth: 520,
      minHeight: 640,
      resizable: true,
      decorations: false,
      shadow: true,
      transparent: true,
    });
    win.once("tauri://error", (e) => {
      push(tr("adb.mirrorError", { err: JSON.stringify(e.payload) }), "stderr");
    });
  }

  // iOS screenshot — capture the iPhone/iPad screen to a PNG (read-only, works
  // today via libimobiledevice). Lives here in Screen & Control.
  const [iosShooting, setIosShooting] = useState(false);
  const [iosShotPath, setIosShotPath] = useState<string | null>(null);
  async function iosScreenshotNow() {
    if (!device.connected || device.mode !== "ios") {
      push(tr("ios.mirror.needs"), "stderr");
      return;
    }
    const file = await save({
      title: tr("ios.shot.save"),
      defaultPath: "ios_screenshot.png",
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (typeof file !== "string") return;
    const dir = file.replace(/[/\\][^/\\]*$/, "");
    setIosShooting(true);
    push(tr("ios.shot.taking"), "system");
    try {
      const saved = await iosScreenshot(device.serial, dir);
      setIosShotPath(saved);
      push(tr("ios.shot.saved", { path: saved }), "system");
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setIosShooting(false);
    }
  }
  async function revealIosShot() {
    if (!iosShotPath) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(iosShotPath);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  const isIos = device.mode === "ios";

  return (
    <>
      {/* MIRROR — Android screen mirror (scrcpy). iOS has no reliable live
          mirror path on current macOS/iOS for third-party apps, so iOS gets a
          Screenshot instead (read-only, works everywhere). */}
      <Section title={tr("mirror.section")}>
        {isIos ? (
          <>
            <p className="rounded-md bg-[var(--color-bg)] px-2.5 py-1.5 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
              {tr("ios.shot.note")}
            </p>
            <Button size="block" disabled={iosShooting} title={tr("ios.shot.hint")} onClick={iosScreenshotNow}>
              {iosShooting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {iosShooting ? tr("ios.shot.taking") : tr("ios.shot.take")}
            </Button>
            {iosShotPath && (
              <>
                <img
                  src={convertFileSrc(iosShotPath)}
                  alt="iOS screenshot"
                  className="mt-1 max-h-[360px] w-full rounded-lg border border-[var(--color-border)] object-contain"
                />
                <Button size="sm" className="w-full" onClick={revealIosShot}>
                  <ExternalLink size={13} />
                  {tr("ios.shot.reveal")}
                </Button>
              </>
            )}
          </>
        ) : (
          <Button
            variant="violet"
            size="block"
            disabled={!(device.connected && device.mode === "adb")}
            title={tr("adb.mirrorHint")}
            onClick={startMirroring}
          >
            {tr("adb.mirror")}
          </Button>
        )}
      </Section>

      {/* ADB — Android-only connection control */}
      <Section title={tr("adb.conn")}>
        <TabHelp>{tr("adb.help")}</TabHelp>
        <Row>
          <Button variant="success" title={tr("adb.startHint")} onClick={() => t.adb(["start-server"])}>
            {tr("adb.start")}
          </Button>
          <Button variant="danger" title={tr("adb.killHint")} onClick={() => t.adb(["kill-server"])}>
            {tr("adb.kill")}
          </Button>
        </Row>
      </Section>

      <Section title={tr("adb.capture")}>
        <Row>
          <Button title={tr("adb.screenshotHint")} onClick={takeScreenshot}>
            <Camera size={14} /> {tr("adb.screenshot")}
          </Button>
          {recording ? (
            <Button variant="danger" title={tr("adb.recordStopHint")} onClick={stopRecording}>
              <Square size={13} /> {tr("adb.recordStop")}
            </Button>
          ) : (
            <Button title={tr("adb.recordHint")} onClick={startRecording}>
              <Video size={14} /> {tr("adb.record")}
            </Button>
          )}
        </Row>
        <Button size="block" title={tr("adb.backupContactsHint")} onClick={backupContacts}>
          <Contact size={14} /> {tr("adb.backupContacts")}
        </Button>
      </Section>

      <Section title={tr("adb.wireless")}>
        <div className="mb-1 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] leading-snug text-sky-800">
          <Wifi size={13} className="mt-[1px] shrink-0" />
          <span>{tr("adb.wirelessDesc")}</span>
        </div>
        <Row>
          <Button title={tr("adb.wirelessEnableHint")} onClick={() => t.adb(["tcpip", "5555"])}>
            {tr("adb.wirelessEnable")}
          </Button>
          <Button title={tr("adb.wirelessUsbHint")} onClick={() => t.raw("adb", ["usb"], true)}>
            {tr("adb.wirelessUsb")}
          </Button>
        </Row>
        <input
          value={wifiIp}
          onChange={(e) => setWifiIp(e.target.value)}
          placeholder={tr("adb.wirelessIp")}
          className="no-drag w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
        />
        <Button
          size="block"
          variant="primary"
          title={tr("adb.wirelessConnectHint")}
          onClick={() => {
            const ip = wifiIp.trim();
            if (!ip) return;
            const target = ip.includes(":") ? ip : `${ip}:5555`;
            t.raw("adb", ["connect", target], true);
          }}
        >
          {tr("adb.wirelessConnect")}
        </Button>
      </Section>

      <Section title={tr("adb.devtools")}>
        <div className="flex gap-1.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={tr("adb.openUrlPlaceholder")}
            className="no-drag min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
          />
          <Button
            title={tr("adb.openUrlHint")}
            onClick={() => {
              const u = url.trim();
              if (u) t.adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", u]);
            }}
          >
            {tr("adb.go")}
          </Button>
        </div>
        <div className="flex gap-1.5">
          <input
            value={typeText}
            onChange={(e) => setTypeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendText();
            }}
            placeholder={tr("adb.inputTextPlaceholder")}
            className="no-drag min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
          />
          <Button title={tr("adb.inputTextHint")} onClick={sendText}>
            {tr("adb.send")}
          </Button>
        </div>
      </Section>

      <Section title={tr("adb.reboot")}>
        <Button size="block" title={tr("adb.rebootNormalHint")} onClick={() => t.adb(["reboot"])}>
          {tr("adb.rebootNormal")}
        </Button>
        <Button size="block" title={tr("adb.rebootRecoveryHint")} onClick={() => t.adb(["reboot", "recovery"])}>
          {tr("adb.rebootRecovery")}
        </Button>
        <Button size="block" title={tr("adb.rebootFastbootHint")} onClick={() => t.adb(["reboot", "bootloader"])}>
          {tr("adb.rebootFastboot")}
        </Button>
      </Section>

      <Section title={tr("adb.sideloadSec")}>
        <Button size="block" title={tr("adb.enterSideloadHint")} onClick={enterSideload}>
          {tr("adb.enterSideload")}
        </Button>
        <Button size="block" variant="primary" title={tr("adb.sideloadFileHint")} onClick={sideloadFile}>
          {tr("adb.sideloadFile")}
        </Button>
      </Section>

      <Section title={tr("adb.info")}>
        <Button size="block" title={tr("adb.listDevicesHint")} onClick={() => t.adb(["devices", "-l"])}>
          {tr("adb.listDevices")}
        </Button>
        <Button size="block" title={tr("adb.getpropHint")} onClick={() => t.adb(["shell", "getprop"])}>
          {tr("adb.getprop")}
        </Button>
      </Section>
    </>
  );
}
