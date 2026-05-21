import type { DashboardConfig } from '$lib/config';
import type { CIPipelineStatus, ReviewItem, ReviewState, UnifiedPR } from '$lib/types';

interface GitHubPRResponse {
	number: number;
	title: string;
	body: string | null;
	state: 'open' | 'closed';
	draft: boolean;
	html_url: string;
	comments: number;
	review_comments: number;
	merged_at: string | null;
	head: { sha: string };
	user: { login: string };
}

interface GitHubCombinedStatusResponse {
	state: string;
}

interface GitHubCheckRunsResponse {
	check_runs: Array<{ conclusion: string | null; status: string }>;
}

export async function fetchGitHubPRs(config: DashboardConfig): Promise<UnifiedPR[]> {
	const teamUsernames = new Set(
		config.team
			.map((m) => m.githubAuthorUsername?.toLowerCase())
			.filter(Boolean) as string[]
	);

	const perRepo = await Promise.all(
		config.github.map((repo) => fetchPRsForRepo(repo, teamUsernames))
	);

	return perRepo.flat();
}

async function fetchPRsForRepo(
	repo: DashboardConfig['github'][number],
	teamUsernames: Set<string>
): Promise<UnifiedPR[]> {
	const { owner, repo: repoName, token } = repo;
	const baseUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls`;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};

	const [openPRs, closedPRs] = await Promise.all([
		fetchPRPage(`${baseUrl}?state=open&per_page=100`, headers),
		fetchPRPage(`${baseUrl}?state=closed&per_page=100`, headers)
	]);

	const mine = [...openPRs, ...closedPRs].filter(
		(pr) => teamUsernames.has(pr.user.login.toLowerCase())
	);

	return Promise.all(
		mine.map(async (pr) => {
			const ciStatus = await fetchGitHubCIStatusForRepo(repo, pr.head.sha).catch(
				() => 'none' as const
			);
			return toUnifiedPR(pr, ciStatus);
		})
	);
}

function toUnifiedPR(pr: GitHubPRResponse, ciStatus: CIPipelineStatus): UnifiedPR {
	let state: UnifiedPR['state'];
	if (pr.draft) {
		state = 'draft';
	} else if (pr.merged_at) {
		state = 'merged';
	} else if (pr.state === 'closed') {
		state = 'closed';
	} else {
		state = 'open';
	}

	return {
		source: 'github',
		id: pr.number,
		title: pr.title,
		state,
		webUrl: pr.html_url,
		commentCount: pr.comments + pr.review_comments,
		ciStatus,
		labels: [],
		description: pr.body ?? '',
		pipelineWebUrl: null,
		pipelineJobs: []
	};
}

async function fetchPRPage(url: string, headers: Record<string, string>): Promise<GitHubPRResponse[]> {
	const response = await fetch(url, { headers });

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`GitHub API error ${response.status}: ${body}`);
	}

	return response.json();
}

async function fetchGitHubCIStatusForRepo(
	repo: DashboardConfig['github'][number],
	sha: string
): Promise<CIPipelineStatus> {
	const { owner, repo: repoName, token } = repo;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};

	const [combinedStatus, checkRuns] = await Promise.all([
		fetchCombinedStatus(owner, repoName, sha, headers),
		fetchCheckRuns(owner, repoName, sha, headers)
	]);

	return resolvedCIStatus(combinedStatus, checkRuns);
}

async function fetchCombinedStatus(
	owner: string,
	repo: string,
	sha: string,
	headers: Record<string, string>
): Promise<GitHubCombinedStatusResponse | null> {
	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`,
		{ headers }
	);
	if (!response.ok) return null;
	return response.json();
}

async function fetchCheckRuns(
	owner: string,
	repo: string,
	sha: string,
	headers: Record<string, string>
): Promise<GitHubCheckRunsResponse | null> {
	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`,
		{ headers }
	);
	if (!response.ok) return null;
	return response.json();
}

function resolvedCIStatus(
	combinedStatus: GitHubCombinedStatusResponse | null,
	checkRuns: GitHubCheckRunsResponse | null
): CIPipelineStatus {
	const statuses: CIPipelineStatus[] = [];

	if (combinedStatus?.state) {
		statuses.push(githubStateToCIStatus(combinedStatus.state));
	}

	if (checkRuns?.check_runs?.length) {
		const checkStatus = resolveCheckRuns(checkRuns.check_runs);
		statuses.push(checkStatus);
	}

	if (statuses.length === 0) return 'none';
	if (statuses.includes('failed')) return 'failed';
	if (statuses.includes('running')) return 'running';
	if (statuses.includes('pending')) return 'pending';
	if (statuses.every((s) => s === 'success')) return 'success';
	return 'none';
}

function githubStateToCIStatus(state: string): CIPipelineStatus {
	if (state === 'success') return 'success';
	if (state === 'failure' || state === 'error') return 'failed';
	if (state === 'pending') return 'pending';
	return 'none';
}

function resolveCheckRuns(
	runs: GitHubCheckRunsResponse['check_runs']
): CIPipelineStatus {
	if (runs.some((r) => r.status !== 'completed')) return 'running';
	if (runs.some((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out')) return 'failed';
	if (runs.every((r) => r.conclusion === 'success' || r.conclusion === 'skipped')) return 'success';
	return 'none';
}

interface GitHubSearchIssueResponse {
	number: number;
	title: string;
	html_url: string;
	user: { login: string };
	pull_request?: unknown;
}

interface GitHubSearchResponse {
	items: GitHubSearchIssueResponse[];
}

interface GitHubReviewResponse {
	state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
	user: { login: string };
	submitted_at: string | null;
}

export async function fetchGitHubReviewRequests(
	config: DashboardConfig
): Promise<ReviewItem[]> {
	const perRepo = await Promise.all(
		config.github.map((repo) => fetchReviewRequestsForRepo(repo))
	);
	return perRepo.flat();
}

async function fetchReviewRequestsForRepo(
	repo: DashboardConfig['github'][number]
): Promise<ReviewItem[]> {
	const { owner, repo: repoName, token, authorUsername } = repo;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};

	const base = `is:pr is:open repo:${owner}/${repoName} -author:${authorUsername}`;
	const [requested, reviewed] = await Promise.all([
		searchIssues(`${base} review-requested:${authorUsername}`, headers),
		searchIssues(`${base} reviewed-by:${authorUsername}`, headers)
	]);

	const byNumber = new Map<number, GitHubSearchIssueResponse>();
	for (const item of [...requested, ...reviewed]) {
		if (item.pull_request) byNumber.set(item.number, item);
	}
	const prs = [...byNumber.values()];

	return Promise.all(
		prs.map(async (pr) => {
			const myReviewState = await fetchMyReviewState(
				owner,
				repoName,
				pr.number,
				authorUsername,
				headers
			).catch(() => 'pending' as ReviewState);
			return {
				source: 'github' as const,
				id: pr.number,
				title: pr.title,
				webUrl: pr.html_url,
				author: pr.user.login,
				repo: `${owner}/${repoName}`,
				myReviewState
			};
		})
	);
}

async function searchIssues(
	query: string,
	headers: Record<string, string>
): Promise<GitHubSearchIssueResponse[]> {
	const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100`;
	const response = await fetch(url, { headers });
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`GitHub search error ${response.status}: ${body}`);
	}
	const data: GitHubSearchResponse = await response.json();
	return data.items;
}

async function fetchMyReviewState(
	owner: string,
	repo: string,
	prNumber: number,
	username: string,
	headers: Record<string, string>
): Promise<ReviewState> {
	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`,
		{ headers }
	);
	if (!response.ok) return 'pending';

	const reviews: GitHubReviewResponse[] = await response.json();
	const mine = reviews
		.filter((r) => r.user.login.toLowerCase() === username.toLowerCase() && r.state !== 'DISMISSED')
		.sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''));

	const latest = mine[mine.length - 1];
	if (!latest) return 'pending';
	if (latest.state === 'APPROVED') return 'approved';
	if (latest.state === 'CHANGES_REQUESTED') return 'changes_requested';
	if (latest.state === 'COMMENTED') return 'commented';
	return 'pending';
}
