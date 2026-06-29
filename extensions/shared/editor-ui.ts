import type { ExtensionCommandContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSelectListTheme, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { Container, Editor, matchesKey, Spacer, Text, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEditor, getEditorArgs } from "./editor-state.js";

function editBufferExternally(text: string, tui: TUI, tempFilePrefix: string): string | undefined | null {
	const tempDir = mkdtempSync(join(tmpdir(), tempFilePrefix));
	const tempFile = join(tempDir, "buffer.md");

	try {
		writeFileSync(tempFile, text, "utf-8");
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");

		const result = spawnSync(getEditor(), getEditorArgs(tempFile, 1), {
			stdio: "inherit",
			env: process.env,
		});

		if (result.status === 0) {
			return readFileSync(tempFile, "utf-8");
		}

		if (result.status === 1) {
			return undefined;
		}

		return null;
	} finally {
		tui.start();
		tui.requestRender(true);
		rmSync(tempDir, { recursive: true, force: true });
	}
}

class ExternalEditableEditor extends Container implements Focusable {
	private editor: Editor;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value;
	}

	constructor(
		private readonly tui: TUI,
		private readonly keybindings: KeybindingsManager,
		theme: Theme,
		title: string,
		prefill: string,
		onSubmit: (value: string) => void,
		private readonly onCancel: () => void,
		private readonly tempFilePrefix: string,
		private readonly notifyError: (message: string) => void,
	) {
		super();

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		this.editor = new Editor(tui, {
			borderColor: (text: string) => theme.fg("accent", text),
			selectList: getSelectListTheme(),
		});
		this.editor.setText(prefill);
		this.editor.onSubmit = onSubmit;
		this.addChild(this.editor);

		this.addChild(new Spacer(1));
		this.addChild(new Text(
			`${rawKeyHint("enter", "submit")}  ${rawKeyHint("shift+enter", "newline")}  ${rawKeyHint("escape/ctrl+c", "cancel")}  ${rawKeyHint("ctrl+g", "external editor")}`,
			1,
			0,
		));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel();
			return;
		}

		if (matchesKey(data, "ctrl+g")) {
			const edited = editBufferExternally(this.editor.getExpandedText(), this.tui, this.tempFilePrefix);
			if (edited === null) {
				this.notifyError("External editor failed");
				return;
			}
			if (edited !== undefined) {
				this.editor.setText(edited.replace(/\n$/, ""));
			}
			return;
		}

		this.editor.handleInput(data);
	}
}

export function promptEditorWithExternalEdit(
	ctx: ExtensionCommandContext,
	title: string,
	prefill: string,
	tempFilePrefix: string,
): Promise<string | undefined> {
	if (ctx.mode !== "tui") {
		return Promise.resolve(undefined);
	}

	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => new ExternalEditableEditor(
		tui,
		keybindings,
		theme,
		title,
		prefill,
		done,
		() => done(undefined),
		tempFilePrefix,
		(message) => ctx.ui.notify(message, "error"),
	));
}
