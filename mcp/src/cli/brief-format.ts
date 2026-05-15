export interface BriefInsight {
	type: "decision" | "learning" | "preference" | "architecture" | "action_item";
	summary: string;
	detail?: string | null;
	updated_at: string;
}

export interface BriefConversation {
	id: string;
	title: string | null;
	compacted_summary: string | null;
	compacted_at: string;
}

export interface BriefData {
	project: { name: string };
	summary: string | null;
	summary_updated_at: string | null;
	recent_conversations: BriefConversation[];
	insights: BriefInsight[];
	now: Date;
}

export interface WorkspaceBriefData {
	projects: Array<{ id: string; name: string; updated_at: string }>;
	now: Date;
}

export function formatBrief(d: BriefData): string {
	const lines: string[] = [];
	lines.push("<synapse-brief>");
	lines.push(`Project: ${d.project.name}`);

	if (d.summary) {
		const ago = d.summary_updated_at
			? relative(new Date(d.summary_updated_at), d.now)
			: "";
		lines.push("");
		lines.push(`## Project summary${ago ? ` (${ago})` : ""}`);
		lines.push(d.summary.slice(0, 1200));
	} else {
		lines.push("");
		lines.push(
			"No project summary yet — will appear as conversations are compacted.",
		);
	}

	if (d.insights.length > 0) {
		lines.push("");
		lines.push("## Recent insights");
		for (const ins of d.insights.slice(0, 10)) {
			const ago = relative(new Date(ins.updated_at), d.now);
			lines.push(`- [${ins.type}, ${ago}] ${ins.summary}`);
		}
	}

	if (d.recent_conversations.length > 0) {
		lines.push("");
		lines.push("## Recent conversations");
		for (const c of d.recent_conversations.slice(0, 3)) {
			const ago = relative(new Date(c.compacted_at), d.now);
			const title = c.title ?? "(untitled)";
			lines.push(`- ${title} (${ago})`);
			if (c.compacted_summary) {
				lines.push(
					`  ${c.compacted_summary.slice(0, 200).replace(/\s+/g, " ")}`,
				);
			}
		}
	}

	lines.push("</synapse-brief>");
	return `${lines.join("\n")}\n`;
}

export function formatWorkspaceBrief(d: WorkspaceBriefData): string {
	const lines: string[] = [];
	lines.push("<synapse-brief>");
	if (d.projects.length === 0) {
		lines.push("Welcome to Synapse.");
		lines.push(
			"No projects yet — start a capture with `synapsesync-mcp capture start`.",
		);
	} else {
		lines.push(
			"No project matched this location. Recent projects across your workspace:",
		);
		for (const p of d.projects.slice(0, 5)) {
			const ago = relative(new Date(p.updated_at), d.now);
			lines.push(`- ${p.name} (last active ${ago})`);
		}
	}
	lines.push("</synapse-brief>");
	return `${lines.join("\n")}\n`;
}

function relative(then: Date, now: Date): string {
	const diff = now.getTime() - then.getTime();
	const min = Math.round(diff / 60_000);
	if (min < 2) return "just now";
	if (min < 60) return `${min} min ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
	const day = Math.round(hr / 24);
	return `${day} day${day === 1 ? "" : "s"} ago`;
}
