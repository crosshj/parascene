import { importMediaFromUrl } from '../../shared/importMedia.js';
import { importAudioFile } from '../../shared/importAudioFile.js';

export function importCreationMedia(intent, { creationToken }) {
 if (intent.provider === 'audio_file') return importAudioFile(intent.file, { creationToken, onStatus: intent.onStatus });
 intent.onStatus?.('Importing…');
 return importMediaFromUrl(intent.provider, intent.url, { creationToken });
}
