import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
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
      <TabHelp>
        <b>Fastboot</b> dipakai saat HP di mode Fastboot/Bootloader (layar hitam
        dengan tulisan). Di sini kamu memasang (flash) file sistem seperti boot,
        recovery, dan membuka bootloader. <b>Hati-hati:</b> salah flash bisa
        membuat HP mati total (brick).
      </TabHelp>

      <Section title="Reboot & Info">
        <Row>
          <Button title="Keluar dari Fastboot dan nyalakan HP normal." onClick={() => t.fastboot(["reboot"])}>
            Reboot Normal
          </Button>
          <Button title="Mulai ulang ke mode Recovery." onClick={() => t.fastboot(["reboot", "recovery"])}>
            Ke Recovery
          </Button>
        </Row>
        <Row>
          <Button
            title="Cek status bootloader: terkunci (locked) atau terbuka (unlocked)."
            onClick={() => t.fastboot(["getvar", "unlocked"])}
          >
            Cek Bootloader
          </Button>
          <Button title="Tampilkan nama/kode model HP (codename)." onClick={() => t.fastboot(["getvar", "product"])}>
            Nama Model
          </Button>
        </Row>
        <Button
          size="block"
          title="Tampilkan SEMUA info teknis HP di mode fastboot (untuk pengguna lanjutan)."
          onClick={() => t.fastboot(["getvar", "all"])}
        >
          Semua Info (Getvar All)
        </Button>
      </Section>

      <Section title="Pasang File Sistem (Flash)">
        <Row>
          <Button title="Pasang file recovery.img (mis. TWRP/OrangeFox) ke partisi recovery." onClick={() => flash("recovery")}>
            Flash Recovery
          </Button>
          <Button title="Pasang file boot.img (kernel) ke partisi boot." onClick={() => flash("boot")}>
            Flash Boot
          </Button>
        </Row>
        <Row>
          <Button title="Pasang init_boot.img (dipakai HP Android 13+ untuk root Magisk)." onClick={() => flash("init_boot")}>
            Flash Init Boot
          </Button>
          <Button title="Pasang vendor_boot.img (bagian dari boot pada sebagian HP)." onClick={() => flash("vendor_boot")}>
            Flash Vendor Boot
          </Button>
        </Row>
        <Button
          size="block"
          variant="info"
          title="Coba jalankan boot.img SEMENTARA tanpa memasang permanen (mis. untuk tes TWRP/root). Hilang setelah restart."
          onClick={bootTemp}
        >
          Boot Sementara (Temp)
        </Button>
      </Section>

      <Section title="Slot A/B (HP dengan 2 slot)">
        <Row>
          <Button title="Lihat slot aktif saat ini (a atau b) pada HP A/B." onClick={() => t.fastboot(["getvar", "current-slot"])}>
            Slot Aktif
          </Button>
          <Button title="Pindah ke slot satunya (a ↔ b). Berguna jika satu slot rusak." onClick={() => t.fastboot(["--set-active=other"])}>
            Ganti Slot
          </Button>
        </Row>
      </Section>

      <Section title="Keamanan Verity / VBMeta">
        <Row>
          <Button
            title="Matikan dm-verity (pengecekan integritas sistem). Diperlukan setelah modifikasi sistem."
            onClick={() => t.fastboot(["oem", "disable-verity"])}
          >
            Matikan Verity
          </Button>
          <Button title="Pasang file vbmeta.img." onClick={() => flash("vbmeta")}>
            Flash vbmeta
          </Button>
        </Row>
        <Button
          size="block"
          title="Pasang vbmeta.img sekaligus mematikan verity & verification (sering dibutuhkan agar HP mau boot setelah dimodifikasi)."
          onClick={() => t.fastboot(["--disable-verity", "--disable-verification", "flash", "vbmeta"])}
        >
          Matikan VBMeta (pilih vbmeta.img)
        </Button>
      </Section>

      <Section title="Buka / Kunci Bootloader">
        <Row>
          <Button
            variant="danger"
            title="BUKA bootloader. WAJIB untuk pasang custom ROM/root, TAPI akan MENGHAPUS SEMUA DATA HP."
            onClick={() => t.fastboot(["flashing", "unlock"])}
          >
            Buka (Unlock)
          </Button>
          <Button title="Kunci kembali bootloader. Juga menghapus data. Lakukan hanya jika sistem sudah resmi/stabil." onClick={() => t.fastboot(["flashing", "lock"])}>
            Kunci (Lock)
          </Button>
        </Row>
        <Button
          size="block"
          title="Perintah unlock alternatif (oem unlock) untuk HP lama yang tidak mendukung 'flashing unlock'."
          onClick={() => t.fastboot(["oem", "unlock"])}
        >
          OEM Unlock (HP lama)
        </Button>
      </Section>
    </>
  );
}
