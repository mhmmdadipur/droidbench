import { open } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
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
      <TabHelp>
        <b>ADB</b> dipakai saat HP menyala normal. Dari sini kamu bisa cermin
        layar HP, reboot ke berbagai mode, dan pasang update (.zip).
      </TabHelp>

      <Section title="Koneksi ADB">
        <Row>
          <Button
            variant="success"
            title="Menyalakan layanan ADB di komputer (biasanya otomatis). Pakai ini jika HP tak terdeteksi."
            onClick={() => t.adb(["start-server"])}
          >
            Nyalakan ADB
          </Button>
          <Button
            variant="danger"
            title="Mematikan layanan ADB. Berguna untuk reset koneksi saat bermasalah."
            onClick={() => t.adb(["kill-server"])}
          >
            Matikan ADB
          </Button>
        </Row>
        <Button
          variant="violet"
          size="block"
          title="Tampilkan & kendalikan layar HP langsung dari komputer (seperti scrcpy)."
          onClick={startMirroring}
        >
          Cermin Layar (Mirror)
        </Button>
      </Section>

      <Section title="Reboot / Mulai Ulang">
        <Button size="block" title="Mulai ulang HP seperti biasa (restart normal)." onClick={() => t.adb(["reboot"])}>
          Reboot Normal
        </Button>
        <Button
          size="block"
          title="Mulai ulang ke mode Recovery (untuk pasang update/ROM, wipe, dll)."
          onClick={() => t.adb(["reboot", "recovery"])}
        >
          Reboot ke Recovery
        </Button>
        <Button
          size="block"
          title="Mulai ulang ke mode Fastboot/Bootloader (untuk flashing via fastboot)."
          onClick={() => t.adb(["reboot", "bootloader"])}
        >
          Reboot ke Fastboot
        </Button>
      </Section>

      <Section title="Pasang Update (Sideload)">
        <Button
          size="block"
          title="Reboot HP ke mode sideload (Recovery → Apply update from ADB) untuk memasang file update."
          onClick={enterSideload}
        >
          Masuk Mode Sideload
        </Button>
        <Button
          size="block"
          variant="primary"
          title="Pilih file update (.zip) dari komputer dan pasang ke HP. HP harus sudah di mode sideload."
          onClick={sideloadFile}
        >
          Pasang File Update (.zip)
        </Button>
      </Section>

      <Section title="Info Perangkat">
        <Button
          size="block"
          title="Tampilkan daftar HP yang terhubung beserta statusnya."
          onClick={() => t.adb(["devices", "-l"])}
        >
          Daftar HP Terhubung
        </Button>
        <Button
          size="block"
          title="Tampilkan semua info teknis HP (properti sistem) — untuk pengguna lanjutan."
          onClick={() => t.adb(["shell", "getprop"])}
        >
          Info Teknis HP
        </Button>
      </Section>
    </>
  );
}
