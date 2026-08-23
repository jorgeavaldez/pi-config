import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function fffPlatformExtension(pi: ExtensionAPI) {
  // Disable until the Android native walker crash is fixed upstream:
  // https://github.com/dmtrKovalenko/fff/issues/786
  if (process.platform === "android") {
    return;
  }

  const { default: fffExtension }: {
    default: (api: ExtensionAPI) => void;
  } = await import(
    new URL("../npm/node_modules/@ff-labs/pi-fff/src/index.ts", import.meta.url).href
  );
  return fffExtension(pi);
}
