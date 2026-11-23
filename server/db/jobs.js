export function createJobStore(client) {
	return {
		async insert(jobType, args, status = "pending") {
			const { data, error } = await client.from("prsn_jobs").insert({
				job_type: jobType,
				status,
				args: args && typeof args === "object" ? args : {},
				meta: {}
			}).select("id").single();
			if (error) throw error;
			return data.id;
		},
		async update(jobId, status, metaPatch = {}) {
			const existing = await client.from("prsn_jobs").select("meta").eq("id", jobId).maybeSingle();
			if (existing.error) throw existing.error;
			const current = existing.data?.meta && typeof existing.data.meta === "object" ? existing.data.meta : {};
			const { error } = await client.from("prsn_jobs").update({
				status,
				meta: { ...current, ...(metaPatch && typeof metaPatch === "object" ? metaPatch : {}) },
				updated_at: new Date().toISOString()
			}).eq("id", jobId);
			if (error) throw error;
		}
	};
}
