import { describe, expect, test } from '@jest/globals';
import {
	applyShowWhenFields,
	extraFieldsFromSelectOptions,
	fieldMatchesShowWhen,
	isAlwaysHiddenField,
	isConfigHiddenField,
	resolveRenderableFields,
} from '../public/shared/providerFormFieldVisibility.js';

const SPEECH_FIELDS = {
	model: {
		type: 'select',
		default: 'google/gemini-3.1-flash-tts',
		options: [
			{
				label: 'MiniMax',
				value: 'minimax/speech-2.8-turbo',
				fields: {
					voice: { type: 'select', options: [{ value: 'English_expressive_narrator', label: 'Narrator' }, { value: 'custom', label: 'Custom' }] },
					voice_id: {
						type: 'text',
						hidden: true,
						show_when: { field: 'voice', equals: 'custom' },
					},
					emotion: { type: 'select', options: [{ value: 'auto', label: 'Auto' }] },
				},
			},
			{
				label: 'Gemini',
				value: 'google/gemini-3.1-flash-tts',
				fields: {
					voice: { type: 'select', options: [{ value: 'Kore', label: 'Kore' }] },
					style: { type: 'text' },
				},
			},
		],
	},
	prompt: { type: 'text', required: true },
};

describe('isAlwaysHiddenField', () => {
	test('hidden without show_when is always hidden', () => {
		expect(isConfigHiddenField({ hidden: true })).toBe(true);
		expect(isAlwaysHiddenField({ hidden: true })).toBe(true);
	});

	test('show_when fields stay in the form', () => {
		const field = { hidden: true, show_when: { field: 'voice', equals: 'custom' } };
		expect(isConfigHiddenField(field)).toBe(true);
		expect(isAlwaysHiddenField(field)).toBe(false);
	});
});

describe('extraFieldsFromSelectOptions', () => {
	test('merges MiniMax voice extras when that model is selected', () => {
		const extra = extraFieldsFromSelectOptions(SPEECH_FIELDS, { model: 'minimax/speech-2.8-turbo' });
		expect(Object.keys(extra)).toEqual(['voice', 'voice_id', 'emotion']);
		expect(extra.voice_id.show_when).toEqual({ field: 'voice', equals: 'custom' });
	});

	test('merges Gemini extras for the default model', () => {
		const extra = extraFieldsFromSelectOptions(SPEECH_FIELDS, {});
		expect(Object.keys(extra)).toEqual(['voice', 'style']);
	});
});

describe('resolveRenderableFields', () => {
	test('keeps top-level fields and adds selected model extras', () => {
		const fields = resolveRenderableFields(SPEECH_FIELDS, { model: 'minimax/speech-2.8-turbo' });
		expect(fields.prompt).toBe(SPEECH_FIELDS.prompt);
		expect(fields.voice.type).toBe('select');
		expect(fields.emotion.options[0].value).toBe('auto');
	});

	test('does not overwrite extras already merged with defaults', () => {
		const voice = { type: 'select', default: 'custom', options: [{ value: 'custom', label: 'Custom' }] };
		const fields = resolveRenderableFields(
			{ ...SPEECH_FIELDS, voice },
			{ model: 'minimax/speech-2.8-turbo' }
		);
		expect(fields.voice).toBe(voice);
		expect(fields.voice_id.show_when.equals).toBe('custom');
	});
});

describe('fieldMatchesShowWhen', () => {
	test('voice_id only matches Custom', () => {
		const field = { show_when: { field: 'voice', equals: 'custom' } };
		expect(fieldMatchesShowWhen(field, { voice: 'custom' })).toBe(true);
		expect(fieldMatchesShowWhen(field, { voice: 'English_expressive_narrator' })).toBe(false);
		expect(fieldMatchesShowWhen({ type: 'text' }, { voice: 'custom' })).toBe(true);
	});
});

describe('applyShowWhenFields', () => {
	test('toggles display and disabled from current values', () => {
		const container = {
			querySelectorAll(selector) {
				if (selector !== '[data-show-when-field]') return [];
				return [this.group];
			},
			group: {
				getAttribute(name) {
					if (name === 'data-show-when-field') return 'voice';
					if (name === 'data-show-when-equals') return 'custom';
					return null;
				},
				style: { display: '' },
				querySelector() {
					return this.input;
				},
				input: {
					removeAttribute(name) {
						if (name === 'disabled') this.disabled = false;
					},
					setAttribute(name) {
						if (name === 'disabled') this.disabled = true;
					},
					disabled: false,
				},
			},
		};

		applyShowWhenFields(container, { voice: 'English_expressive_narrator' });
		expect(container.group.style.display).toBe('none');
		expect(container.group.input.disabled).toBe(true);

		applyShowWhenFields(container, { voice: 'custom' });
		expect(container.group.style.display).toBe('');
		expect(container.group.input.disabled).toBe(false);
	});
});
