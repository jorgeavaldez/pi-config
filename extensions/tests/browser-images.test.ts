import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { Type } from "typebox";
import { Check } from "typebox/value";

const sheetDetails = Type.Object({
  artifacts: Type.Array(Type.Unknown()),
  contactSheet: Type.Object({
    path: Type.String(),
    width: Type.Number(),
    height: Type.Number(),
    sourcePaths: Type.Array(Type.String()),
  }),
});

test("per-call browser contact sheets through Pi's result middleware", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-browser-images-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const loaded = await discoverAndLoadExtensions(
    [fileURLToPath(new URL("../browser-images.ts", import.meta.url))],
    cwd,
    cwd,
  );
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const models = await ModelRuntime.create({
    authPath: join(cwd, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(cwd, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    cwd,
    SessionManager.inMemory(cwd),
    new ModelRegistry(models),
  );

  const fixtures = [
    {
      name: "home-desktop.png",
      width: 1200,
      height: 800,
      color: [200, 40, 50, 255],
    },
    {
      name: "home-mobile.png",
      width: 390,
      height: 844,
      color: [20, 80, 200, 255],
    },
  ];
  const artifacts = fixtures.map((fixture) => ({
    command: "screenshot",
    kind: "image",
    absolutePath: join(cwd, fixture.name),
    exists: true,
    status: "saved",
  }));
  const images: ImageContent[] = [];
  const originals: Uint8Array[] = [];
  for (const fixture of fixtures) {
    const pixels = new Uint8Array(fixture.width * fixture.height * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set(fixture.color, i);
    const image = new PhotonImage(pixels, fixture.width, fixture.height);
    let bytes: Uint8Array;
    try {
      bytes = image.get_bytes();
    } finally {
      image.free();
    }
    const path = join(cwd, fixture.name);
    await writeFile(path, bytes);
    originals.push(bytes);
    images.push({
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: "image/png",
    });
  }
  const text: TextContent = { type: "text", text: "Browser capture results" };
  const details = { artifacts, artifactVerification: { verified: true } };
  const event: ToolResultEvent = {
    type: "tool_result",
    toolCallId: "capture-call",
    toolName: "agent_browser",
    input: { args: ["batch", "--bail"] },
    content: [text, ...images],
    details,
    isError: false,
  };

  await t.test(
    "a batch returns one labeled sheet, preserving originals and artifact metadata",
    async () => {
      const original = structuredClone(event);
      const result = await runner.emitToolResult(event);
      assert.ok(result);
      assert.ok(Check(sheetDetails, result.details));
      const sheet = result.details.contactSheet;
      t.after(() => rm(sheet.path, { force: true }));
      assert.deepEqual(
        sheet.sourcePaths,
        artifacts.map((artifact) => artifact.absolutePath),
      );
      assert.strictEqual(result.details.artifacts, artifacts);
      assert.ok("artifactVerification" in result.details);
      assert.strictEqual(
        result.details.artifactVerification,
        details.artifactVerification,
      );
      assert.deepEqual(result.content?.slice(0, -2), [text]);
      assert.equal(result.isError, false);
      assert.deepEqual(event, original);
      const inline = result.content?.filter((part) => part.type === "image");
      assert.equal(inline?.length, 1);
      assert.ok(inline?.[0]);
      const saved = await readFile(sheet.path);
      assert.deepEqual(Buffer.from(inline[0].data, "base64"), saved);
      const decoded = PhotonImage.new_from_byteslice(saved);
      try {
        assert.equal(decoded.get_width(), sheet.width);
        assert.equal(decoded.get_height(), sheet.height);
        assert.equal(sheet.width, 1920);
        assert.equal(sheet.height, 960);
        const pixels = decoded.get_raw_pixels();
        // The scaled desktop is 936 x 624; mobile remains 390 x 844, without stretching.
        assert.deepEqual(
          [
            ...pixels.slice(
              (80 * sheet.width + 20) * 4,
              (80 * sheet.width + 20) * 4 + 4,
            ),
          ],
          fixtures[0]?.color,
        );
        assert.deepEqual(
          [
            ...pixels.slice(
              (700 * sheet.width + 20) * 4,
              (700 * sheet.width + 20) * 4 + 4,
            ),
          ],
          [32, 32, 32, 255],
        );
        assert.deepEqual(
          [
            ...pixels.slice(
              (80 * sheet.width + 1500) * 4,
              (80 * sheet.width + 1500) * 4 + 4,
            ),
          ],
          fixtures[1]?.color,
        );
        assert.ok(
          pixels
            .slice(0, 60 * sheet.width * 4)
            .some((value, index) => index % 4 !== 3 && value > 100),
          "embedded-font labels rendered above the captures",
        );
      } finally {
        decoded.free();
      }
      for (const [index, artifact] of artifacts.entries()) {
        assert.deepEqual(
          new Uint8Array(await readFile(artifact.absolutePath)),
          originals[index],
        );
      }
    },
  );

  await t.test(
    "saved-only results still compose, and separate calls get separate output files",
    async () => {
      const paths = new Set<string>();
      for (const input of [
        { script: "capture two pages" },
        { job: { steps: [] } },
      ]) {
        const result = await runner.emitToolResult({
          ...event,
          input,
          content: [text],
        });
        assert.ok(Check(sheetDetails, result?.details));
        const path = result.details.contactSheet.path;
        t.after(() => rm(path, { force: true }));
        paths.add(path);
        assert.equal(
          result.content?.filter((part) => part.type === "image").length,
          1,
        );
      }
      assert.equal(paths.size, 2);
    },
  );

  await t.test(
    "a partially failed batch keeps its error and excludes stale/missing artifacts",
    async () => {
      const failedDetails = {
        artifacts: [
          ...artifacts,
          {
            ...artifacts[0],
            absolutePath: join(cwd, "stale.png"),
            status: "stale",
          },
          {
            ...artifacts[0],
            absolutePath: join(cwd, "missing.png"),
            exists: false,
            status: "missing",
          },
        ],
        resultCategory: "failure",
        failureCategory: "timeout",
      };
      const result = await runner.emitToolResult({
        ...event,
        details: failedDetails,
        isError: true,
      });
      assert.ok(Check(sheetDetails, result?.details));
      const path = result.details.contactSheet.path;
      t.after(() => rm(path, { force: true }));
      assert.equal(result.isError, true);
      assert.strictEqual(result.details.artifacts, failedDetails.artifacts);
      assert.ok("failureCategory" in result.details);
      assert.equal(result.details.failureCategory, "timeout");
      assert.deepEqual(
        result.details.contactSheet.sourcePaths,
        artifacts.map((artifact) => artifact.absolutePath),
      );
    },
  );

  await t.test(
    "single captures stay deferred and never accumulate across calls",
    async () => {
      for (const artifact of artifacts) {
        const single: ToolResultEvent = {
          ...event,
          content: [text, ...images.slice(0, 1)],
          details: { artifacts: [artifact] },
        };
        const result = await runner.emitToolResult(single);
        assert.equal(
          result?.content?.some((part) => part.type === "image"),
          false,
        );
        assert.strictEqual(result?.details, single.details);
      }
    },
  );

  await t.test("repeated paths do not become duplicate panels", async () => {
    const result = await runner.emitToolResult({
      ...event,
      details: { artifacts: [artifacts[0], artifacts[0]] },
    });
    assert.equal(
      result?.content?.some((part) => part.type === "image"),
      false,
    );
  });

  await t.test(
    "composition failure defers originals without changing browser success or failure",
    async () => {
      const badDetails = {
        artifacts: [
          ...artifacts,
          {
            ...artifacts[0],
            absolutePath: join(cwd, "removed-after-capture.png"),
          },
        ],
      };
      for (const isError of [false, true]) {
        const result = await runner.emitToolResult({
          ...event,
          details: badDetails,
          isError,
        });
        assert.ok(result);
        assert.equal(
          result.content?.some((part) => part.type === "image"),
          false,
        );
        assert.deepEqual(result.content?.slice(0, -1), [text]);
        assert.equal(result.content?.at(-1)?.type, "text");
        assert.strictEqual(result.details, badDetails);
        assert.equal(result.isError, isError);
      }
    },
  );

  await t.test(
    "unrecognized metadata cannot trigger file reads or an empty image-only result",
    async () => {
      for (const details of [
        null,
        {
          artifacts: [
            null,
            {},
            { kind: "image", absolutePath: "/unverified.png" },
          ],
        },
      ]) {
        const result = await runner.emitToolResult({
          ...event,
          details,
          content: images,
        });
        assert.equal(result?.content?.length, 1);
        assert.equal(result?.content?.[0]?.type, "text");
      }
    },
  );

  await t.test(
    "text-only browser results without multiple screenshots are untouched",
    async () => {
      for (const content of [[], [text]]) {
        for (const isError of [false, true]) {
          assert.equal(
            await runner.emitToolResult({
              ...event,
              details: {},
              content,
              isError,
            }),
            undefined,
          );
        }
      }
    },
  );

  await t.test(
    "explicit read and other tools retain their image attachments",
    async () => {
      for (const toolName of ["read", "other_tool"]) {
        const other: ToolResultEvent = {
          ...event,
          toolName,
          input: { path: "/tmp/contact-sheet.png" },
        };
        const original: ToolResultEvent = structuredClone(other);
        assert.equal(await runner.emitToolResult(other), undefined);
        assert.deepEqual(other, original);
      }
    },
  );
});
