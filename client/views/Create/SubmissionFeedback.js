// Submission errors belong to the mounted workflow; late replies must not close a new overlay.
import '../../components/Toast/Toast.css';
import { showToast } from '../../shared/toast.js';

export function reportSubmissionError(error, active = true) {
 if (!active || error?.name === 'AbortError' || error?.code === 'occupancy_cancelled') return;
 showToast(error?.message || 'Unable to start creation. Please try again.', { durationMs: 5000 });
}
