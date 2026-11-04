// Per-brand flashing guides for the "Other brands" tab.
//
// Content rules (this is advice people will act on with their own phone):
//  • Only OFFICIAL links, and only ones we verified exist. Where a brand has no
//    verified official page we say so in text instead of guessing a URL.
//  • Be honest about brands that do not allow unlocking (no false promises).
//  • Keep claims general and hedged — policies change per model/region/carrier.
// Samsung and Xiaomi/Redmi/POCO have dedicated tabs and are not listed here. Brands
// without a tab of their own are covered by GENERIC_GUIDE (shown in the Fastboot tab).

export type L = { en: string; id: string };
export interface BrandLink {
  label: string;
  url: string;
}
export type UnlockSupport = "official" | "conditional" | "none";

export interface BrandGuide {
  id: string;
  name: string;
  unlockSupport: UnlockSupport;
  /** Brand-specific way to enter Fastboot, when we are confident of it. */
  enterFastboot?: L;
  unlock: L;
  unlockLinks: BrandLink[];
  firmware: L;
  firmwareLinks: BrandLink[];
  flash: L;
  flashLinks: BrandLink[];
  after?: L;
}

const AOSP_UNLOCK_DOC: BrandLink = {
  label: "Android: lock & unlock the bootloader",
  url: "https://source.android.com/docs/core/architecture/bootloader/locking_unlocking",
};

export const BRANDS: BrandGuide[] = [
  {
    id: "pixel",
    name: "Google Pixel",
    unlockSupport: "official",
    enterFastboot: {
      en: "Power off, then hold Power + Volume Down. Or from a running phone: adb reboot bootloader.",
      id: "Matikan HP, lalu tahan Power + Volume Bawah. Atau dari HP yang menyala: adb reboot bootloader.",
    },
    unlock: {
      en: "Settings → Developer options → turn on OEM unlocking. Reboot to Fastboot and run: fastboot flashing unlock, then confirm on the phone with the volume keys. This erases all data. Pixels sold through some carriers (for example Verizon) cannot be unlocked.",
      id: "Setelan → Opsi pengembang → nyalakan OEM unlocking. Reboot ke Fastboot lalu jalankan: fastboot flashing unlock, dan konfirmasi di HP dengan tombol volume. Ini menghapus semua data. Pixel yang dijual lewat operator tertentu (misalnya Verizon) tidak bisa di-unlock.",
    },
    unlockLinks: [AOSP_UNLOCK_DOC],
    firmware: {
      en: "Google publishes factory images and full OTA images for every Pixel. Pick the exact model codename and build.",
      id: "Google menyediakan factory image dan full OTA untuk setiap Pixel. Pilih codename model dan build yang persis.",
    },
    firmwareLinks: [
      { label: "Factory images", url: "https://developers.google.com/android/images" },
      { label: "Full OTA images", url: "https://developers.google.com/android/ota" },
    ],
    flash: {
      en: "Easiest: the Android Flash Tool in your browser (no commands). Manual: extract the factory image and run its flash-all script from inside that folder with the phone in Fastboot. Read the 'special instructions' notes on the factory-image page first — recent monthly releases can require extra bootloader steps.",
      id: "Paling mudah: Android Flash Tool di browser (tanpa perintah). Manual: ekstrak factory image lalu jalankan skrip flash-all dari dalam foldernya dengan HP di Fastboot. Baca dulu catatan 'special instructions' di halaman factory image — rilis bulanan terbaru bisa butuh langkah bootloader tambahan.",
    },
    flashLinks: [{ label: "Android Flash Tool", url: "https://flash.android.com" }],
    after: {
      en: "After restoring a STOCK factory image you can relock with: fastboot flashing lock. Do not relock while running a custom ROM.",
      id: "Setelah memulihkan factory image STOCK kamu bisa mengunci ulang dengan: fastboot flashing lock. Jangan dikunci ulang saat memakai custom ROM.",
    },
  },
  {
    id: "oneplus",
    name: "OnePlus",
    unlockSupport: "official",
    unlock: {
      en: "Settings → Developer options → turn on OEM unlocking. Reboot to Fastboot and run: fastboot flashing unlock (older models: fastboot oem unlock), then confirm on the phone. This erases all data. Some carrier variants are locked by the carrier.",
      id: "Setelan → Opsi pengembang → nyalakan OEM unlocking. Reboot ke Fastboot lalu jalankan: fastboot flashing unlock (model lama: fastboot oem unlock), lalu konfirmasi di HP. Ini menghapus semua data. Sebagian varian operator dikunci oleh operatornya.",
    },
    unlockLinks: [AOSP_UNLOCK_DOC],
    firmware: {
      en: "Download the full OTA / ROM package for your exact model and region from OnePlus's official support site. Do not mix regions (for example India vs Global).",
      id: "Unduh paket full OTA / ROM untuk model dan region yang persis dari situs support resmi OnePlus. Jangan campur region (misalnya India vs Global).",
    },
    firmwareLinks: [],
    flash: {
      en: "Most OnePlus phones are flashed from a full OTA ZIP (local upgrade or recovery/sideload). Newer models use dynamic partitions, so some images are flashed in fastbootd (userspace Fastboot) — follow the guide for your model.",
      id: "Kebanyakan OnePlus di-flash dari ZIP full OTA (local upgrade atau recovery/sideload). Model baru memakai dynamic partition, jadi sebagian image di-flash lewat fastbootd (Fastboot userspace) — ikuti panduan untuk modelmu.",
    },
    flashLinks: [],
  },
  {
    id: "motorola",
    name: "Motorola",
    unlockSupport: "conditional",
    enterFastboot: {
      en: "Power off, then hold Power + Volume Down. Or: adb reboot bootloader.",
      id: "Matikan HP, lalu tahan Power + Volume Bawah. Atau: adb reboot bootloader.",
    },
    unlock: {
      en: "Needs a key from Motorola. Enable OEM unlocking in Developer options, then in Fastboot run: fastboot oem get_unlock_data. Join the printed lines into one string (drop the '(bootloader)' prefixes), submit it on Motorola's unlock page (sign-in required), and they email you a key. Then run: fastboot oem unlock <KEY>. Not every model or carrier variant is eligible.",
      id: "Butuh kunci dari Motorola. Aktifkan OEM unlocking di Opsi pengembang, lalu di Fastboot jalankan: fastboot oem get_unlock_data. Gabungkan baris yang tercetak jadi satu string (buang awalan '(bootloader)'), kirim di halaman unlock Motorola (wajib login), lalu mereka mengirim kunci lewat email. Setelah itu jalankan: fastboot oem unlock <KUNCI>. Tidak semua model atau varian operator memenuhi syarat.",
    },
    unlockLinks: [
      { label: "Motorola unlock page", url: "https://en-us.support.motorola.com/app/standalone/bootloader/unlock-your-device-a" },
    ],
    firmware: {
      en: "Use Lenovo's official Rescue and Smart Assistant (LMSA) tool to restore stock firmware for your model, or follow your device's guide for manual image flashing.",
      id: "Pakai tool resmi Lenovo, Rescue and Smart Assistant (LMSA), untuk memulihkan firmware stock modelmu, atau ikuti panduan perangkatmu untuk flash image manual.",
    },
    firmwareLinks: [],
    flash: {
      en: "Stock firmware is a set of partition images flashed one by one with fastboot, and the exact command list differs per model. Prefer LMSA's automatic restore unless you know the sequence for your device.",
      id: "Firmware stock berupa kumpulan image partisi yang di-flash satu per satu dengan fastboot, dan daftar perintahnya berbeda tiap model. Utamakan restore otomatis LMSA kecuali kamu tahu urutan untuk perangkatmu.",
    },
    flashLinks: [],
    after: {
      en: "Unlocking voids the Motorola warranty (stated on their unlock page).",
      id: "Unlock menghanguskan garansi Motorola (tertulis di halaman unlock mereka).",
    },
  },
  {
    id: "sony",
    name: "Sony Xperia",
    unlockSupport: "conditional",
    enterFastboot: {
      en: "On most models: power off, hold Volume Up, and plug in the USB cable — the notification LED turns blue in Fastboot. Or: adb reboot bootloader.",
      id: "Di kebanyakan model: matikan HP, tahan Volume Atas, lalu colok kabel USB — LED notifikasi menyala biru di Fastboot. Atau: adb reboot bootloader.",
    },
    unlock: {
      en: "Sony offers an official unlock for supported models: you request an unlock code with the phone's IMEI on Sony's page, then unlock with the command Sony gives you. Unlocking erases data and can remove DRM keys, which may degrade camera quality and disables official updates. Not all models are supported.",
      id: "Sony menyediakan unlock resmi untuk model yang didukung: kamu meminta kode unlock dengan IMEI HP di halaman Sony, lalu unlock dengan perintah yang diberikan Sony. Unlock menghapus data dan bisa menghapus kunci DRM, yang dapat menurunkan kualitas kamera dan menonaktifkan update resmi. Tidak semua model didukung.",
    },
    unlockLinks: [
      { label: "Sony: unlock bootloader", url: "https://opendevices.sony.net/aosp-on-xperia-open-devices/get-started/unlock-bootloader" },
    ],
    firmware: {
      en: "Restore official software with Sony's Xperia Companion. Sony Open Devices also publishes AOSP-based builds for supported Xperia models.",
      id: "Pulihkan software resmi dengan Xperia Companion dari Sony. Sony Open Devices juga menyediakan build berbasis AOSP untuk model Xperia yang didukung.",
    },
    firmwareLinks: [{ label: "Sony Open Devices", url: "https://opendevices.sony.net/" }],
    flash: {
      en: "For custom or AOSP builds, follow the instructions of the specific build you downloaded (usually flashing images with fastboot). For official software use Xperia Companion's repair function instead of manual flashing.",
      id: "Untuk build custom atau AOSP, ikuti instruksi build yang kamu unduh (biasanya flash image dengan fastboot). Untuk software resmi, pakai fungsi repair Xperia Companion, bukan flash manual.",
    },
    flashLinks: [],
  },
  {
    id: "oppo-realme",
    name: "Oppo / Realme",
    unlockSupport: "conditional",
    unlock: {
      en: "Availability depends heavily on model and region, and many newer models can no longer be unlocked. Where it is offered, you apply through the brand's 'Deep Testing' / in-depth test app, wait for approval (days), then unlock with fastboot flashing unlock. Check your exact model on a reliable source before buying or attempting anything.",
      id: "Ketersediaan sangat bergantung pada model dan region, dan banyak model baru sudah tidak bisa di-unlock. Kalau ditawarkan, kamu mendaftar lewat aplikasi 'Deep Testing' / in-depth test milik brand, menunggu persetujuan (beberapa hari), lalu unlock dengan fastboot flashing unlock. Cek modelmu di sumber yang terpercaya sebelum membeli atau mencoba apa pun.",
    },
    unlockLinks: [AOSP_UNLOCK_DOC],
    firmware: {
      en: "Use official firmware from the brand's support site or the OTA updater inside the phone. Match model, region and Android version exactly.",
      id: "Pakai firmware resmi dari situs support brand atau updater OTA di dalam HP. Cocokkan model, region, dan versi Android dengan persis.",
    },
    firmwareLinks: [],
    flash: {
      en: "Official updates are installed through the phone's own updater (local install). Manual fastboot flashing is model-specific and many of these phones use MediaTek chips that need different tools — not covered here.",
      id: "Update resmi dipasang lewat updater bawaan HP (instal lokal). Flash fastboot manual itu spesifik per model dan banyak HP ini memakai chip MediaTek yang butuh tool berbeda — tidak dibahas di sini.",
    },
    flashLinks: [],
  },
  {
    id: "vivo",
    name: "Vivo / iQOO",
    unlockSupport: "none",
    unlock: {
      en: "Vivo and iQOO generally do not provide an official bootloader unlock, so most models cannot be unlocked and custom ROMs are not realistic. Do not trust paid 'unlock' services — they are unofficial and risky.",
      id: "Vivo dan iQOO umumnya tidak menyediakan unlock bootloader resmi, jadi kebanyakan model tidak bisa di-unlock dan custom ROM tidak realistis. Jangan percaya jasa 'unlock' berbayar — itu tidak resmi dan berisiko.",
    },
    unlockLinks: [],
    firmware: {
      en: "Restore or update only with the OTA updater inside the phone or the brand's official service channel.",
      id: "Pulihkan atau update hanya lewat updater OTA di dalam HP atau jalur service resmi brand.",
    },
    firmwareLinks: [],
    flash: {
      en: "There is no supported flashing path for end users on a locked bootloader. Droidbench's Debloat and Diagnostics tabs still work on these phones.",
      id: "Tidak ada jalur flashing yang didukung untuk pengguna dengan bootloader terkunci. Tab Debloat dan Diagnostik Droidbench tetap berfungsi di HP ini.",
    },
    flashLinks: [],
  },
  {
    id: "huawei-honor",
    name: "Huawei / Honor",
    unlockSupport: "none",
    unlock: {
      en: "Huawei ended its official bootloader unlock-code service in 2018 (Honor phones of that era too), so there is no official way to unlock. Paid third-party unlock services exist but are unofficial and risky; Droidbench does not cover them.",
      id: "Huawei menghentikan layanan kode unlock bootloader resminya pada 2018 (HP Honor di era itu juga), jadi tidak ada cara resmi untuk unlock. Jasa unlock pihak ketiga berbayar memang ada tetapi tidak resmi dan berisiko; Droidbench tidak mencakupnya.",
    },
    unlockLinks: [],
    firmware: {
      en: "Use the phone's built-in updater or Huawei's official service channel for software recovery.",
      id: "Pakai updater bawaan HP atau jalur service resmi Huawei untuk pemulihan software.",
    },
    firmwareLinks: [],
    flash: {
      en: "No supported fastboot flashing path on a locked bootloader. Huawei phones also lack Google services on newer models, which limits custom-ROM value.",
      id: "Tidak ada jalur flash fastboot yang didukung dengan bootloader terkunci. Model Huawei baru juga tanpa layanan Google, yang mengurangi manfaat custom ROM.",
    },
    flashLinks: [],
  },
  {
    id: "asus",
    name: "ASUS",
    unlockSupport: "conditional",
    unlock: {
      en: "ASUS has offered an official 'Unlock Device' app for some models (installed on the phone from ASUS's support page for your model). Support differs per model and over time — check ASUS's support page for your exact device.",
      id: "ASUS pernah menyediakan aplikasi resmi 'Unlock Device' untuk beberapa model (dipasang di HP dari halaman support ASUS untuk modelmu). Dukungannya berbeda per model dan berubah dari waktu ke waktu — cek halaman support ASUS untuk perangkatmu.",
    },
    unlockLinks: [AOSP_UNLOCK_DOC],
    firmware: {
      en: "Download the firmware for your exact model and region from ASUS's official support page.",
      id: "Unduh firmware untuk model dan region yang persis dari halaman support resmi ASUS.",
    },
    firmwareLinks: [],
    flash: {
      en: "ASUS firmware is normally installed as an update package from the phone or via recovery. Follow the instructions on the download page for your model.",
      id: "Firmware ASUS biasanya dipasang sebagai paket update dari HP atau lewat recovery. Ikuti instruksi di halaman unduhan untuk modelmu.",
    },
    flashLinks: [],
  },
  {
    id: "nothing",
    name: "Nothing / CMF",
    unlockSupport: "official",
    unlock: {
      en: "Settings → Developer options → turn on OEM unlocking. Reboot to Fastboot and run: fastboot flashing unlock, then confirm on the phone. This erases all data.",
      id: "Setelan → Opsi pengembang → nyalakan OEM unlocking. Reboot ke Fastboot lalu jalankan: fastboot flashing unlock, lalu konfirmasi di HP. Ini menghapus semua data.",
    },
    unlockLinks: [AOSP_UNLOCK_DOC],
    firmware: {
      en: "Nothing publishes official update packages and recovery images for its phones. Look for your exact model on Nothing's official support or community pages.",
      id: "Nothing menerbitkan paket update dan image recovery resmi untuk HP-nya. Cari modelmu yang persis di halaman support atau komunitas resmi Nothing.",
    },
    firmwareLinks: [],
    flash: {
      en: "Use the official package and the instructions published with it. Newer models use dynamic partitions (fastbootd), so follow the model-specific steps.",
      id: "Pakai paket resmi dan instruksi yang diterbitkan bersamanya. Model baru memakai dynamic partition (fastbootd), jadi ikuti langkah khusus modelnya.",
    },
    flashLinks: [],
  },
];

/**
 * Guidance for any brand that does not have its own tab (Tecno, Infinix, Lenovo, …)
 * and for unknown devices. It is shown inside the Fastboot tab rather than as a tab
 * of its own, which keeps the navigation list short.
 */
export const GENERIC_GUIDE: BrandGuide = {
  id: "generic",
  name: "Other (Tecno, Infinix, Lenovo, …)",
  unlockSupport: "conditional",
  unlock: {
    en: "Try: Settings → Developer options → OEM unlocking. If the toggle is missing or greyed out, the brand or carrier blocks unlocking. If it works, reboot to Fastboot and run: fastboot flashing unlock (older phones: fastboot oem unlock). This erases all data. Budget MediaTek phones often need brand-specific tools that this guide does not cover.",
    id: "Coba: Setelan → Opsi pengembang → OEM unlocking. Kalau toggle tidak ada atau abu-abu, brand atau operator memblokir unlock. Kalau bisa, reboot ke Fastboot lalu jalankan: fastboot flashing unlock (HP lama: fastboot oem unlock). Ini menghapus semua data. HP MediaTek kelas murah sering butuh tool khusus brand yang tidak dibahas di panduan ini.",
  },
  unlockLinks: [AOSP_UNLOCK_DOC],
  firmware: {
    en: "Use only the brand's official firmware for your exact model, region and variant. Never flash firmware from a different model.",
    id: "Pakai hanya firmware resmi brand untuk model, region, dan varian yang persis. Jangan pernah flash firmware dari model lain.",
  },
  firmwareLinks: [],
  flash: {
    en: "Use the Fastboot tab's tools for individual partitions, or the brand's own flashing tool if it provides one.",
    id: "Pakai tool di tab Fastboot untuk partisi satuan, atau tool flashing milik brand bila ada.",
  },
  flashLinks: [],
};

export function getBrand(id: string): BrandGuide {
  return BRANDS.find((b) => b.id === id) ?? BRANDS[0];
}
