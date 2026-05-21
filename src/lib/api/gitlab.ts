import type { DashboardConfig } from '$lib/config';
import type { CIPipelineJob, CIPipelineStatus, GitLabMR, ReviewItem, ReviewState } from '$lib/types';

interface GitLabBranchResponse {
	name: string;
}

interface GitLabMRResponse {
	iid: number;
	title: string;
	state: 'opened' | 'merged' | 'closed';
	draft: boolean;
	web_url: string;
	user_notes_count: number;
	labels: string[];
	description: string;
}

interface GitLabPipelineResponse {
	id: number;
	status: string;
	web_url: string;
}

interface GitLabPipelineJobResponse {
	id: number;
	name: string;
	status: string;
	web_url: string;
}

export interface CIPipelineInfo {
	status: CIPipelineStatus;
	pipelineId: number | null;
	pipelineWebUrl: string | null;
	jobs: CIPipelineJob[];
}

export async function fetchGitLabMRs(config: DashboardConfig): Promise<GitLabMR[]> {
	const baseUrl = `${config.gitlab.baseUrl}/api/v4/projects/${config.gitlab.projectId}/merge_requests`;
	const headers = { 'PRIVATE-TOKEN': config.gitlab.token };

	const usernames = config.team
		.map((m) => m.gitlabAuthorUsername)
		.filter(Boolean) as string[];

	const perMember = await Promise.all(
		usernames.map(async (username) => {
			const authorParam = `author_username=${encodeURIComponent(username)}`;
			const [openMRs, mergedMRs] = await Promise.all([
				fetchMRPage(`${baseUrl}?state=opened&${authorParam}&per_page=100`, headers),
				fetchMRPage(`${baseUrl}?state=merged&${authorParam}&per_page=100`, headers)
			]);
			return [...openMRs, ...mergedMRs];
		})
	);

	const seen = new Set<number>();
	const all = perMember.flat().filter((mr) => {
		if (seen.has(mr.iid)) return false;
		seen.add(mr.iid);
		return true;
	});

	return all.map((mr) => ({
		iid: mr.iid,
		title: mr.title,
		state: mr.state,
		draft: mr.draft,
		webUrl: mr.web_url,
		userNotesCount: mr.user_notes_count,
		labels: mr.labels ?? [],
		description: mr.description ?? ''
	}));
}

async function fetchMRPage(url: string, headers: Record<string, string>): Promise<GitLabMRResponse[]> {
	const response = await fetch(url, { headers });

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`GitLab API error ${response.status}: ${body}`);
	}

	return response.json();
}

export async function fetchGitLabBranches(config: DashboardConfig, search: string): Promise<string[]> {
	const url = `${config.gitlab.baseUrl}/api/v4/projects/${config.gitlab.projectId}/repository/branches?search=${encodeURIComponent(search)}&per_page=20`;
	const response = await fetch(url, {
		headers: { 'PRIVATE-TOKEN': config.gitlab.token }
	});

	if (!response.ok) return [];

	const branches: GitLabBranchResponse[] = await response.json();
	return branches.map((b) => b.name);
}

export async function fetchCIPipelineInfo(
	config: DashboardConfig,
	mrIid: number
): Promise<CIPipelineInfo> {
	const url = `${config.gitlab.baseUrl}/api/v4/projects/${config.gitlab.projectId}/merge_requests/${mrIid}/pipelines`;

	const response = await fetch(url, {
		headers: { 'PRIVATE-TOKEN': config.gitlab.token }
	});

	if (!response.ok) {
		return { status: 'none', pipelineId: null, pipelineWebUrl: null, jobs: [] };
	}

	const pipelines: GitLabPipelineResponse[] = await response.json();

	if (pipelines.length === 0) {
		return { status: 'none', pipelineId: null, pipelineWebUrl: null, jobs: [] };
	}

	const pipeline = pipelines[0];
	const validStatuses: CIPipelineStatus[] = [
		'success',
		'failed',
		'running',
		'pending',
		'canceled',
		'skipped'
	];

	const status: CIPipelineStatus = validStatuses.includes(pipeline.status as CIPipelineStatus)
		? (pipeline.status as CIPipelineStatus)
		: 'none';

	const jobs = await fetchPipelineJobs(config, pipeline.id);

	return {
		status,
		pipelineId: pipeline.id,
		pipelineWebUrl: pipeline.web_url,
		jobs
	};
}

interface GitLabReviewMRResponse {
	iid: number;
	title: string;
	web_url: string;
	author: { username: string };
}

interface GitLabApprovalsResponse {
	approved_by: Array<{ user: { username: string } }>;
}

export async function fetchGitLabReviewRequests(
	config: DashboardConfig
): Promise<ReviewItem[]> {
	const baseUrl = `${config.gitlab.baseUrl}/api/v4/projects/${config.gitlab.projectId}/merge_requests`;
	const headers = { 'PRIVATE-TOKEN': config.gitlab.token };
	const me = config.gitlab.authorUsername;
	const url = `${baseUrl}?state=opened&reviewer_username=${encodeURIComponent(me)}&per_page=100`;

	const response = await fetch(url, { headers });
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`GitLab review-requests error ${response.status}: ${body}`);
	}

	const mrs: GitLabReviewMRResponse[] = await response.json();

	return Promise.all(
		mrs.map(async (mr) => {
			const approved = await hasGitLabApproval(config, mr.iid, me).catch(() => false);
			return {
				source: 'gitlab' as const,
				id: mr.iid,
				title: mr.title,
				webUrl: mr.web_url,
				author: mr.author.username,
				repo: config.gitlab.repo,
				myReviewState: (approved ? 'approved' : 'pending') as ReviewState
			};
		})
	);
}

async function hasGitLabApproval(
	config: DashboardConfig,
	mrIid: number,
	username: string
): Promise<boolean> {
	const url = `${config.gitlab.baseUrl}/api/v4/projects/${config.gitlab.projectId}/merge_requests/${mrIid}/approvals`;
	const response = await fetch(url, {
		headers: { 'PRIVATE-TOKEN': config.gitlab.token }
	});
	if (!response.ok) return false;
	const data: GitLabApprovalsResponse = await response.json();
	return data.approved_by.some(
		(a) => a.user.username.toLowerCase() === username.toLowerCase()
	);
}

async function fetchPipelineJobs(
	config: DashboardConfig,
	pipelineId: number
): Promise<CIPipelineJob[]> {
	const url = `${config.gitlab.baseUrl}/api/v4/projects/${config.gitlab.projectId}/pipelines/${pipelineId}/jobs`;

	const response = await fetch(url, {
		headers: { 'PRIVATE-TOKEN': config.gitlab.token }
	});

	if (!response.ok) return [];

	const jobs: GitLabPipelineJobResponse[] = await response.json();
	return jobs.map((j) => ({
		id: j.id,
		name: j.name,
		status: j.status,
		webUrl: j.web_url
	}));
}
