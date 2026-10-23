import { open } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "../ui/Button";
import { Row, Section } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";

export function AdbTab() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();

  async function enterSideload() {
    if (!device.connected) {
      push("No device connected. Connect a device in ADB mode first.", "stderr");
      return;
    }
    push("Rebooting device into sideload mode… wait for the recovery screen.", "system");
    t.adb(["reboot", "sideload"]);
  }

  async function sideloadFile() {
    const file = await open({
      multiple: false,
      filters: [{ name: "OTA ZIP", extensions: ["zip"] }],
    });
    if (typeof file !== "string") return;
    push(
      "Starting ADB sideload. The device must already be in sideload mode " +
        "(Recovery → Apply update from ADB).",
      "system",
    );
    push(`Sideloading: ${file}`, "system");
    t.adb(["sideload", file]);
  }

  function startMirroring() {
    if (!device.connected || device.mode !== "adb") {
      push("Mirroring needs a device connected in ADB mode.", "stderr");
      return;
    }
    push("Opening mirror window…", "system");
    const win = new WebviewWindow("mirror", {
      url: "index.html?view=mirror",
      title: "Droidbench Mirror",
      width: 760,
      height: 860,
      minWidth: 560,
      minHeight: 600,
      resizable: true,
      decorations: false,
      shadow: true,
      transparent: true,
    });
    win.once("tauri://error", (e) => {
      push(`Mirror window error: ${JSON.stringify(e.payload)}`, "stderr");
    });
  }

  return (
    <>
      <Section title="ADB Server">
        <Row>
          <Button variant="success" onClick={() => t.adb(["start-server"])}>
            Start Server
          </Button>
          <Button variant="danger" onClick={() => t.adb(["kill-server"])}>
            Kill Server
          </Button>
        </Row>
        <Button variant="violet" size="block" onClick={startMirroring}>
          Start Mirroring
        </Button>
      </Section>

      <Section title="Reboot">
        <Button size="block" onClick={() => t.adb(["reboot"])}>
          Reboot System
        </Button>
        <Button size="block" onClick={() => t.adb(["reboot", "recovery"])}>
          Reboot Recovery
        </Button>
        <Button size="block" onClick={() => t.adb(["reboot", "bootloader"])}>
          Reboot Fastboot
        </Button>
      </Section>

      <Section title="Sideload">
        <Button size="block" onClick={enterSideload}>
          Enter Sideload Mode
        </Button>
        <Button size="block" variant="primary" onClick={sideloadFile}>
          ADB Sideload File (.zip)
        </Button>
      </Section>

      <Section title="Shell">
        <Button size="block" onClick={() => t.adb(["devices", "-l"])}>
          List Devices
        </Button>
        <Button size="block" onClick={() => t.adb(["shell", "getprop"])}>
          Dump Properties
        </Button>
      </Section>
    </>
  );
}
