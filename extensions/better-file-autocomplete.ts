/**
 * Fuzzy File Autocomplete Extension for pi
 *
 * Replaces the default @ file autocomplete with true fuzzy matching.
 * Uses fd with a fuzzy regex pattern (e.g., "remplage" → "r.*e.*m.*p.*l.*a.*g.*e")
 *
 * Features:
 * - True fuzzy matching: "remplage" finds "remediation/planner/agent.py"
 * - Case insensitive
 * - Matches against full path
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CombinedAutocompleteProvider } from "@mariozechner/pi-tui";
import { spawnSync } from "child_process";
import { basename } from "path";

/**
 * Convert query into a fuzzy regex pattern for fd.
 * Example: "remplage" => "r.*e.*m.*p.*l.*a.*g.*e"
 */
function buildFuzzyRegex(query: string): string {
  // Escape regex metacharacters, then join with .*
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.split("").join(".*");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const proto = CombinedAutocompleteProvider.prototype as any;

    // Guard against double-patching
    if (proto._fuzzyPatched) return;
    proto._fuzzyPatched = true;

    // Store original for empty query fallback
    const originalFn = proto.getFuzzyFileSuggestions;

    proto.getFuzzyFileSuggestions = function (query: string) {
      if (!this.fdPath) return [];

      // Empty query: use original behavior
      if (!query || !query.trim()) {
        return originalFn.call(this, query);
      }

      try {
        const fuzzyPattern = buildFuzzyRegex(query);

        const result = spawnSync(
          this.fdPath,
          [
            "--base-directory",
            this.basePath,
            "--max-results",
            "100",
            "--type",
            "f",
            "--type",
            "d",
            "--full-path",
            "--regex",
            "-i",
            fuzzyPattern,
          ],
          {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 10 * 1024 * 1024,
          }
        );

        if (result.status !== 0 || !result.stdout) return [];

        const lines = result.stdout.trim().split("\n").filter(Boolean);

        return lines.slice(0, 20).map((line) => {
          const isDir = line.endsWith("/");
          const path = isDir ? line.slice(0, -1) : line;
          return {
            value: `@${line}`,
            label: basename(path) + (isDir ? "/" : ""),
            description: path,
          };
        });
      } catch {
        return [];
      }
    };
  });
}
