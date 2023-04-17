<template>
	<div
		:class="$style['code-node-editor-container']"
		@mouseover="onMouseOver"
		@mouseout="onMouseOut"
		ref="codeNodeEditorContainer"
	>
		<div ref="codeNodeEditor" class="ph-no-capture"></div>
		<n8n-button
			v-if="isCloud && (isEditorHovered || isEditorFocused)"
			size="small"
			type="tertiary"
			:class="$style['ask-ai-button']"
			@mousedown="onAskAiButtonClick"
		>
			{{ $locale.baseText('codeNodeEditor.askAi') }}
		</n8n-button>
	</div>
</template>

<script lang="ts">
import type { PropType } from 'vue';
import { mapStores } from 'pinia';
import mixins from 'vue-typed-mixins';

import { Compartment, EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter as createLinter } from '@codemirror/lint';

import { readOnlyEditorExtensions, writableEditorExtensions } from './baseExtensions';
import { linterExtension } from './linter';
import { completerExtension } from './completer';
import { codeNodeEditorTheme } from './theme';
import { workflowHelpers } from '@/mixins/workflowHelpers'; // for json field completions
import { ASK_AI_MODAL_KEY, CODE_NODE_TYPE } from '@/constants';
import { codeNodeEditorEventBus } from '@/event-bus';
import { ALL_ITEMS_PLACEHOLDER, EACH_ITEM_PLACEHOLDER } from './constants';
import { useRootStore } from '@/stores/n8nRootStore';
import Modal from '../Modal.vue';
import { useSettingsStore } from '@/stores/settings';

const languages = ['javaScript', 'json'] as const;
type Language = (typeof languages)[number];

const modes = ['runOnceForAllItems', 'runOnceForEachItem'] as const;
type Mode = (typeof modes)[number];

const placeholders: Partial<Record<Language, Record<Mode, string>>> = {
	javaScript: {
		runOnceForAllItems: ALL_ITEMS_PLACEHOLDER,
		runOnceForEachItem: EACH_ITEM_PLACEHOLDER,
	},
};

export default mixins(linterExtension, completerExtension, workflowHelpers).extend({
	name: 'code-node-editor',
	components: { Modal },
	props: {
		mode: {
			type: String as PropType<Mode>,
			validator: (value: Mode): boolean => modes.includes(value),
		},
		language: {
			type: String as PropType<Language>,
			default: 'javaScript' as Language,
			validator: (value: Language): boolean => languages.includes(value),
		},
		isReadOnly: {
			type: Boolean,
			default: false,
		},
		value: {
			type: String,
		},
		maxHeight: {
			type: Boolean,
			default: false,
		},
	},
	data() {
		return {
			editor: null as EditorView | null,
			linterCompartment: new Compartment(),
			isEditorHovered: false,
			isEditorFocused: false,
		};
	},
	watch: {
		mode(newMode, previousMode: Mode) {
			this.reloadLinter();

			if (this.content.trim() === placeholders[this.language]?.[previousMode]) {
				this.refreshPlaceholder();
			}
		},
	},
	computed: {
		...mapStores(useRootStore),
		isCloud() {
			return useSettingsStore().deploymentType === 'cloud';
		},
		content(): string {
			if (!this.editor) return '';

			return this.editor.state.doc.toString();
		},
		placeholder(): string {
			return placeholders[this.language]?.[this.mode] ?? '';
		},
		linter(): Extension | undefined {
			switch (this.language) {
				case 'javaScript':
					return this.linterExtension();
				case 'json':
					return createLinter(jsonParseLinter());
			}
		},
	},
	methods: {
		onMouseOver(event: MouseEvent) {
			const fromElement = event.relatedTarget as HTMLElement;
			const ref = this.$refs.codeNodeEditorContainer as HTMLDivElement;

			if (!ref.contains(fromElement)) this.isEditorHovered = true;
		},
		onMouseOut(event: MouseEvent) {
			const fromElement = event.relatedTarget as HTMLElement;
			const ref = this.$refs.codeNodeEditorContainer as HTMLDivElement;

			if (!ref.contains(fromElement)) this.isEditorHovered = false;
		},
		onAskAiButtonClick() {
			this.$telemetry.track('User clicked ask ai button', { source: 'code' });

			this.uiStore.openModal(ASK_AI_MODAL_KEY);
		},
		reloadLinter() {
			if (!this.editor) return;

			if (this.linter) {
				this.editor.dispatch({
					effects: this.linterCompartment.reconfigure(this.linter),
				});
			}
		},
		refreshPlaceholder() {
			if (!this.editor) return;

			this.editor.dispatch({
				changes: { from: 0, to: this.content.length, insert: this.placeholder },
			});
		},
		highlightLine(line: number | 'final') {
			if (!this.editor) return;

			if (line === 'final') {
				this.editor.dispatch({
					selection: { anchor: this.content.length },
				});
				return;
			}

			this.editor.dispatch({
				selection: { anchor: this.editor.state.doc.line(line).from },
			});
		},
		trackCompletion(viewUpdate: ViewUpdate) {
			const completionTx = viewUpdate.transactions.find((tx) => tx.isUserEvent('input.complete'));

			if (!completionTx) return;

			try {
				// @ts-ignore - undocumented fields
				const { fromA, toB } = viewUpdate?.changedRanges[0];
				const full = this.content.slice(fromA, toB);
				const lastDotIndex = full.lastIndexOf('.');

				let context = null;
				let insertedText = null;

				if (lastDotIndex === -1) {
					context = '';
					insertedText = full;
				} else {
					context = full.slice(0, lastDotIndex);
					insertedText = full.slice(lastDotIndex + 1);
				}

				this.$telemetry.track('User autocompleted code', {
					instance_id: this.rootStore.instanceId,
					node_type: CODE_NODE_TYPE,
					field_name: this.mode === 'runOnceForAllItems' ? 'jsCodeAllItems' : 'jsCodeEachItem',
					field_type: 'code',
					context,
					inserted_text: insertedText,
				});
			} catch {}
		},
	},
	destroyed() {
		if (!this.isReadOnly) codeNodeEditorEventBus.off('error-line-number', this.highlightLine);
	},
	mounted() {
		if (!this.isReadOnly) codeNodeEditorEventBus.on('error-line-number', this.highlightLine);

		// empty on first load, default param value
		if (!this.value) {
			this.$emit('valueChanged', this.placeholder);
		}

		const extensions: Extension[] = [
			...readOnlyEditorExtensions,
			EditorState.readOnly.of(this.isReadOnly),
			codeNodeEditorTheme({ maxHeight: this.maxHeight }),
		];

		if (this.linter) extensions.push(this.linterCompartment.of(this.linter));

		if (this.isReadOnly) {
			extensions.push(EditorView.editable.of(this.isReadOnly));
		} else {
			extensions.push(
				...writableEditorExtensions,
				EditorView.domEventHandlers({
					focus: () => {
						this.isEditorFocused = true;
					},
					blur: () => {
						this.isEditorFocused = false;
					},
				}),
				EditorView.updateListener.of((viewUpdate) => {
					if (!viewUpdate.docChanged) return;

					this.trackCompletion(viewUpdate);

					this.$emit('valueChanged', this.editor?.state.doc.toString());
				}),
			);
		}

		switch (this.language) {
			case 'json':
				extensions.push(json());
				break;
			case 'javaScript':
				extensions.push(javascript(), this.autocompletionExtension());
				break;
		}

		const state = EditorState.create({
			doc: this.value || this.placeholder,
			extensions,
		});

		this.editor = new EditorView({
			parent: this.$refs.codeNodeEditor as HTMLDivElement,
			state,
		});
	},
});
</script>

<style lang="scss" module>
.code-node-editor-container {
	position: relative;

	& > div {
		height: 100%;
	}
}

.ask-ai-button {
	position: absolute;
	top: var(--spacing-2xs);
	right: var(--spacing-2xs);
}
</style>
