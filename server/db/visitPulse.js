function detailsOf(snapshot) {
	const details = snapshot?.details;
	if (details && typeof details === "object" && !Array.isArray(details)) return details;
	if (typeof details === "string") {
		try {
			const parsed = JSON.parse(details);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

export function createVisitPulseQueries(client) {
	return {
		upsertVisitPulseDay: {
			run: async (snapshot) => {
				const day = String(snapshot?.day || "").trim();
				if (!day) throw new Error("visit pulse snapshot missing day");
				const row = {
					day,
					unique_visitors: Number(snapshot.unique_visitors) || 0,
					authed_visitors: Number(snapshot.authed_visitors) || 0,
					anon_visitors: Number(snapshot.anon_visitors) || 0,
					total_hits: Number(snapshot.total_hits) || 0,
					total_active_blocks: Number(snapshot.total_active_blocks) || 0,
					flushed_at: snapshot.flushed_at || new Date().toISOString(),
					details: detailsOf(snapshot)
				};
				const { error } = await client
					.from("prsn_visit_pulse_days")
					.upsert(row, { onConflict: "day" });
				if (error) throw error;
				return { changes: 1 };
			}
		},
		selectVisitPulseDay: {
			get: async (day) => {
				const { data, error } = await client
					.from("prsn_visit_pulse_days")
					.select("day, unique_visitors, authed_visitors, anon_visitors, total_hits, total_active_blocks, flushed_at, details")
					.eq("day", String(day || "").trim())
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		}
	};
}
