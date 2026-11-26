import express from 'express';
import config from '../data/advancedCreateConfig.json' with { type: 'json' };

/**
 * Hard-coded stand-in for the create pane.
 * Output is the top level: image, audio, video, and upload.
 * Upload has fields and no model list. The others list models and the routes they can run.
 * A filled field role (image, ref, audio) picks the route. An empty one stays on text.
 * A route with modelField takes its model id from that field's value.
 * A select option may carry its own routes, credits, server, and fields. The chosen option replaces the model's routes, credits, and server. Its fields show only while it is chosen.
 * A model may name a section. The model list shows that label above each run of models.
 */
export function createAdvancedCreateConfigRoutes() {
	const router = express.Router();
	router.get('/api/create/advanced-config', (_req, res) => {
		res.json(config);
	});
	return router;
}
