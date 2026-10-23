declare module "tinyh264" {
  export function init(): Promise<any>;
}
declare module "tinyh264/es/TinyH264Decoder.js" {
  const TinyH264Decoder: any;
  export default TinyH264Decoder;
}
declare module "tinyh264/es/TinyH264Worker.js" {
  export function init(): void;
}
