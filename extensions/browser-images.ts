import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

const browserArtifacts = Type.Object({ artifacts: Type.Array(Type.Unknown()) });
const savedScreenshot = Type.Object({
  command: Type.Literal("screenshot"),
  kind: Type.Literal("image"),
  absolutePath: Type.String(),
  exists: Type.Literal(true),
  status: Type.Literal("saved"),
});

/** Compose each browser call's saved screenshots; leave originals and status intact. */
export default function browserImages(pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "agent_browser") return;

    const content = event.content.filter((part) => part.type !== "image");
    const details = Check(browserArtifacts, event.details)
      ? event.details
      : undefined;
    const screenshots = details
      ? [
          ...new Set(
            details.artifacts
              .filter((artifact) => Check(savedScreenshot, artifact))
              .map((artifact) => artifact.absolutePath)
              .filter(isAbsolute),
          ),
        ]
      : [];

    if (screenshots.length < 2) {
      if (content.length === event.content.length) return;
      return {
        content: [
          ...content,
          {
            type: "text",
            text: "Local screenshot policy: inline browser images deferred. Use read on a saved image when needed; batch two or more screenshots with distinct paths for an automatic contact sheet.",
          },
        ],
      };
    }

    try {
      const { PhotonImage, resize, SamplingFilter, watermark, draw_text } =
        await import("@silvia-odwyer/photon-node");
      const columns = Math.ceil(Math.sqrt(screenshots.length));
      const rows = Math.ceil(screenshots.length / columns);
      const cellWidth = Math.min(960, Math.floor(2048 / columns));
      const cellHeight = Math.min(960, Math.floor(2048 / rows));
      const imageWidth = cellWidth - 24;
      const imageHeight = cellHeight - 76;
      if (imageWidth < 1 || imageHeight < 1) {
        throw new Error(
          "Too many screenshots to fit in one contact sheet; use smaller batches.",
        );
      }

      const width = columns * cellWidth;
      const height = rows * cellHeight;
      const pixels = new Uint8Array(width * height * 4).fill(32);
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
      const sheet = new PhotonImage(pixels, width, height);
      let bytes: Uint8Array;
      try {
        for (const [index, path] of screenshots.entries()) {
          const image = PhotonImage.new_from_byteslice(
            await readFile(path, { signal: ctx.signal }),
          );
          try {
            const originalWidth = image.get_width();
            const originalHeight = image.get_height();
            const scale = Math.min(
              1,
              imageWidth / originalWidth,
              imageHeight / originalHeight,
            );
            const thumbnail = resize(
              image,
              Math.max(1, Math.round(originalWidth * scale)),
              Math.max(1, Math.round(originalHeight * scale)),
              SamplingFilter.Lanczos3,
            );
            try {
              const x = (index % columns) * cellWidth + 12;
              const y = Math.floor(index / columns) * cellHeight + 12;
              const label = `${index + 1}. ${basename(path)}`;
              const labelLimit = Math.floor(imageWidth / 20);
              draw_text(
                sheet,
                label.length > labelLimit
                  ? `${label.slice(0, labelLimit - 3)}...`
                  : label,
                x,
                y,
                20,
              );
              draw_text(
                sheet,
                `${originalWidth} x ${originalHeight}`,
                x,
                y + 26,
                18,
              );
              watermark(
                sheet,
                thumbnail,
                BigInt(
                  x + Math.floor((imageWidth - thumbnail.get_width()) / 2),
                ),
                BigInt(y + 52),
              );
            } finally {
              thumbnail.free();
            }
          } finally {
            image.free();
          }
        }
        bytes = sheet.get_bytes();
      } finally {
        sheet.free();
      }

      const path = join(
        tmpdir(),
        `pi-browser-contact-sheet-${randomUUID()}.png`,
      );
      await writeFile(path, bytes, {
        flag: "wx",
        mode: 0o600,
        signal: ctx.signal,
      });
      return {
        details: {
          ...details,
          contactSheet: { path, width, height, sourcePaths: screenshots },
        },
        content: [
          ...content,
          {
            type: "text",
            text: `Local screenshot policy: original inline images replaced with one contact sheet of ${screenshots.length} saved screenshots.\nContact sheet: ${path}\nPanels:\n${screenshots.map((source, index) => `${index + 1}. ${source}`).join("\n")}\nOriginal files, artifact metadata, and browser status are unchanged. Read an original for finer detail; a contact sheet is an overview, not proof that every browser step succeeded.`,
          },
          {
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          ...content,
          {
            type: "text",
            text: `Automatic contact sheet failed: ${error instanceof Error ? error.message : String(error)}\nOriginal inline images remain deferred. Saved files, artifact metadata, and browser status are unchanged; use read on the needed originals.`,
          },
        ],
      };
    }
  });
}
