---
name: screenshot-review
description: Capture and review screenshots with agent_browser using automatic contact sheets. Use before any screenshot-based visual review, single-screen or multi-page/state/viewport, and when comparing screens.
---

# Screenshot Review: Automatic Contact Sheets

The local `extensions/browser-images.ts` hook automatically composes two or more distinct, verified saved screenshots from the same result into a **contact sheet** (screenshot montage). It returns the sheet as the only inline image, reports its saved path and `details.contactSheet`, and preserves originals, existing artifact metadata, and browser success/error status. It also handles saved screenshots omitted from upstream inline attachments.

The hook owns composition; agents only need to batch captures.

## Capture

- For multi-screen visual review, capture the known pages, states, or viewports in one safe `agent_browser` call/batch. Avoid capture → inspect → capture → inspect when the captures do not depend on visual feedback.
- Use distinct, descriptive output paths such as `home-desktop.png` and `home-mobile.png`; filenames and image dimensions become panel labels.
- For known linear capture sequences (open, resize, wait, screenshot), prefer `args: ["batch", "--bail"]` with a JSON array of argv arrays encoded as the `stdin` string, rather than `agent_browser_code`. Reserve `agent_browser_code` for actual conditional or looping orchestration; it drives the same persistent browser as ordinary `agent_browser` calls.
- Grouping is per call/batch, not across calls. Keep batches small enough for readable comparisons. For long pages, capture relevant sections instead of shrinking an entire page into an illegible thumbnail. One composite is not automatically cheaper; dimensions and detail still matter.
- If a capture batch or code call fails, inspect the failure and retry the independent captures together in an ordinary batch, re-establishing the page and viewport there. Do not fall back to separate screenshot calls unless later captures genuinely require new visual feedback; separate calls cannot produce a shared contact sheet.

## Review

- Inspect the automatically returned sheet first. Do not write composition commands, search for fonts, install image tools, or separately `read` the same sheet.
- After reviewing a sheet, read only the originals or crops needed to resolve a specific visual question.
- Single screenshots remain deferred. Use `read` immediately when a screenshot must determine the next interaction or the task concerns one screen.
- Check artifact verification and browser errors independently: a contact sheet can contain the successful captures from a partially failed batch and is not proof that every step passed.
- If composition fails, the hook reports a warning and leaves originals deferred; read the needed originals rather than building a replacement image workflow.
- Evidence-only screenshots do not require a visual correctness claim. Saving a file proves capture, not visual correctness. Keep originals available for detail inspection and handoff.
