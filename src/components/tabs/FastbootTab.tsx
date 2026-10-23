import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Row, Section } from "../ui/Section";
import { useTools } from "../../lib/useTools";

export function FastbootTab() {
  const t = useTools();

  async function flash(partition: string) {
    const file = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["img", "bin"] }],
    });
    if (typeof file === "string") {
      t.fastboot(["flash", partition, file]);
    }
  }

  async function bootTemp() {
    const file = await open({
      multiple: false,
      filters: [{ name: "Boot image", extensions: ["img"] }],
    });
    if (typeof file === "string") {
      t.fastboot(["boot", file]);
    }
  }

  return (
    <>
      <Section title="Reboot / Info">
        <Row>
          <Button onClick={() => t.fastboot(["reboot"])}>Reboot System</Button>
          <Button onClick={() => t.fastboot(["reboot", "recovery"])}>Reboot Recovery</Button>
        </Row>
        <Row>
          <Button onClick={() => t.fastboot(["getvar", "unlocked"])}>Check UBL</Button>
          <Button onClick={() => t.fastboot(["getvar", "product"])}>Product</Button>
        </Row>
        <Button size="block" onClick={() => t.fastboot(["getvar", "all"])}>
          Getvar All
        </Button>
      </Section>

      <Section title="Flashing">
        <Row>
          <Button onClick={() => flash("recovery")}>Flash Recovery</Button>
          <Button onClick={() => flash("boot")}>Flash Boot</Button>
        </Row>
        <Row>
          <Button onClick={() => flash("init_boot")}>Flash Init Boot</Button>
          <Button onClick={() => flash("vendor_boot")}>Flash Vendor Boot</Button>
        </Row>
        <Button size="block" variant="info" onClick={bootTemp}>
          Boot (Temp)
        </Button>
      </Section>

      <Section title="Slot A/B">
        <Row>
          <Button onClick={() => t.fastboot(["getvar", "current-slot"])}>Active Slot</Button>
          <Button onClick={() => t.fastboot(["--set-active=other"])}>Switch Slot</Button>
        </Row>
      </Section>

      <Section title="Slot Security">
        <Row>
          <Button onClick={() => t.fastboot(["oem", "disable-verity"])}>Dis-Verity</Button>
          <Button onClick={() => flash("vbmeta")}>Flash vbmeta</Button>
        </Row>
        <Button size="block" onClick={() => t.fastboot(["--disable-verity", "--disable-verification", "flash", "vbmeta"])}>
          Dis-VBMeta (pick vbmeta.img)
        </Button>
      </Section>

      <Section title="Bootloader Unlock">
        <Row>
          <Button variant="danger" onClick={() => t.fastboot(["flashing", "unlock"])}>
            Unlock
          </Button>
          <Button onClick={() => t.fastboot(["flashing", "lock"])}>Lock</Button>
        </Row>
        <Button size="block" onClick={() => t.fastboot(["oem", "unlock"])}>
          OEM Unlock
        </Button>
      </Section>
    </>
  );
}
