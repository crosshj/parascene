export const HOME_ROW_HEIGHT = 280;

export function homeTileWidth(sourceWidth, sourceHeight) {
	const width = Number(sourceWidth);
	const height = Number(sourceHeight);
	if (!(width > 0) || !(height > 0)) return 201;
	return Math.max(1, Math.round(HOME_ROW_HEIGHT * (width / height)));
}
