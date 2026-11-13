import assert from 'node:assert/strict';
import test from 'node:test';
import {
	BLUE_IMAGE_GROUP_ID,
	BLUE_IMAGE_GROUP_LABEL,
	collectCuratedBlueImageOptions,
	findImageFamilyOption,
	resolveBlueImageVariant,
} from '../client/components/CreateComposer/blueImageModels.js';

const BLUE_SERVER_ID = 6;

function blueServer() {
	return {
		id: BLUE_SERVER_ID,
		server_config: {
			methods: {
				text2image: {
					name: 'Text To Image',
					fields: {
						model: {
							options: [
								{ value: 'diffusion_models/flux3-image-klein-base-int8-convrot.safetensors' },
								{ value: 'diffusion_models/krea2/krea2_turbo_int8_convrot.safetensors' },
								{ value: 'diffusion_models/moss_image_sft_int8_convrot.safetensors' },
								{ value: 'diffusion_models/qwen_image_2.1_int8_convrot.safetensors' },
								{ value: 'diffusion_models/z-image/z_image_turbo_bf16.safetensors' },
								{ value: 'diffusion_models/flux/flux1-dev.safetensors' },
							],
						},
					},
				},
				image2image: {
					name: 'Image To Image',
					fields: {
						model: {
							options: [
								{ value: 'flux3_klein_i2i' },
								{ value: 'moss_image_i2i' },
								{ value: 'qwen_image_2_1_i2i' },
							],
						},
					},
				},
			},
		},
	};
}

test('Blue image models are one picker row, grouped as Parascene Blue', () => {
	const options = collectCuratedBlueImageOptions(blueServer());
	assert.deepEqual(
		options.map((option) => option.label),
		['Flux 3 Klein', 'Krea 2 Turbo', 'MOSS Image SFT', 'Qwen Image 2.1', 'Z-Image Turbo']
	);
	assert.ok(options.every((option) => option.methodLabel === BLUE_IMAGE_GROUP_LABEL));
	assert.ok(options.every((option) => option.groupId === BLUE_IMAGE_GROUP_ID));
	assert.equal(new Set(options.map((option) => option.label)).size, options.length);
});

test('submit uses the image method only when an image is attached', () => {
	const flux = collectCuratedBlueImageOptions(blueServer()).find((option) => option.label === 'Flux 3 Klein');
	const fromText = resolveBlueImageVariant(flux, false);
	assert.equal(fromText.methodKey, 'text2image');
	assert.equal(fromText.value, 'diffusion_models/flux3-image-klein-base-int8-convrot.safetensors');
	const fromImage = resolveBlueImageVariant(flux, true);
	assert.equal(fromImage.methodKey, 'image2image');
	assert.equal(fromImage.value, 'flux3_klein_i2i');
});

test('a stored image-to-image route still selects the shared picker row', () => {
	const options = collectCuratedBlueImageOptions(blueServer());
	const stored = `${BLUE_SERVER_ID}\x1eimage2image\x1eqwen_image_2_1_i2i`;
	const match = findImageFamilyOption(options, stored);
	assert.equal(match?.label, 'Qwen Image 2.1');
	assert.equal(match?.selectValue, options.find((option) => option.label === 'Qwen Image 2.1').selectValue);
});

test('models without an image-to-image side cannot be submitted from an image', () => {
	const options = collectCuratedBlueImageOptions(blueServer());
	for (const label of ['Krea 2 Turbo', 'Z-Image Turbo']) {
		const option = options.find((row) => row.label === label);
		assert.equal(option.image2imageValue, '');
		assert.equal(resolveBlueImageVariant(option, false)?.methodKey, 'text2image');
		assert.equal(resolveBlueImageVariant(option, true), null);
	}
});

test('a live method that dropped one side omits that side only', () => {
	const server = blueServer();
	server.server_config.methods.image2image.fields.model.options =
		server.server_config.methods.image2image.fields.model.options.filter(
			(option) => option.value !== 'moss_image_i2i'
		);
	const moss = collectCuratedBlueImageOptions(server).find((option) => option.label === 'MOSS Image SFT');
	assert.equal(moss.text2imageValue.includes('moss_image_sft'), true);
	assert.equal(moss.image2imageValue, '');
	assert.equal(resolveBlueImageVariant(moss, true), null);
});
