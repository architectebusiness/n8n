import {
	dropCursor,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
} from '@codemirror/view';
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { acceptCompletion } from '@codemirror/autocomplete';
import {
	history,
	indentWithTab,
	insertNewlineAndIndent,
	toggleComment,
	redo,
	deleteCharBackward,
} from '@codemirror/commands';
import { lintGutter } from '@codemirror/lint';

import { codeInputHandler } from '@/plugins/codemirror/inputHandlers/code.inputHandler';
import { Extension } from '@codemirror/state';

export const readOnlyEditorExtensions: readonly Extension[] = [
	lineNumbers(),
	EditorView.lineWrapping,
	highlightSpecialChars(),
	lintGutter(),
];

export const writableEditorExtensions: readonly Extension[] = [
	highlightActiveLineGutter(),
	history(),
	foldGutter(),
	codeInputHandler(),
	dropCursor(),
	indentOnInput(),
	bracketMatching(),
	highlightActiveLine(),
	keymap.of([
		{ key: 'Enter', run: insertNewlineAndIndent },
		{ key: 'Tab', run: acceptCompletion },
		{ key: 'Enter', run: acceptCompletion },
		{ key: 'Mod-/', run: toggleComment },
		{ key: 'Mod-Shift-z', run: redo },
		{ key: 'Backspace', run: deleteCharBackward, shift: deleteCharBackward },
		indentWithTab,
	]),
];
