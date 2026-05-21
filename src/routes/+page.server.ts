import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/config';
import { fetchJiraWorkItems, fetchJiraProjectStatuses } from '$lib/api/jira';
import {
	fetchGitLabMRs,
	fetchCIPipelineInfo,
	fetchGitLabBranches,
	fetchGitLabReviewRequests
} from '$lib/api/gitlab';
import type { CIPipelineInfo } from '$lib/api/gitlab';
import { fetchGitHubPRs, fetchGitHubReviewRequests } from '$lib/api/github';
import type { DashboardRow, GitLabMR, ReviewItem, UnifiedPR } from '$lib/types';

type ApiResult<T> = { data: T; error: null } | { data: null; error: string };

function resilient<T>(promise: Promise<T>): Promise<ApiResult<T>> {
	return promise
		.then((data) => ({ data, error: null }) satisfies ApiResult<T>)
		.catch((err: unknown) => ({
			data: null,
			error: err instanceof Error ? err.message : String(err)
		}));
}

function isGitLabUnavailable(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	if (err instanceof TypeError) return true;
	const msg = err.message.toLowerCase();
	return (
		msg.includes('fetch failed') ||
		msg.includes('econnrefused') ||
		msg.includes('econnreset') ||
		msg.includes('etimedout') ||
		msg.includes('503')
	);
}

function gitlabMRToUnifiedPR(mr: GitLabMR, ciInfo: CIPipelineInfo): UnifiedPR {
	let state: UnifiedPR['state'];
	if (mr.draft) {
		state = 'draft';
	} else if (mr.state === 'merged') {
		state = 'merged';
	} else if (mr.state === 'closed') {
		state = 'closed';
	} else {
		state = 'open';
	}

	return {
		source: 'gitlab',
		id: mr.iid,
		title: mr.title,
		state,
		webUrl: mr.webUrl,
		commentCount: mr.userNotesCount,
		ciStatus: ciInfo.status,
		labels: mr.labels,
		description: mr.description,
		pipelineWebUrl: ciInfo.pipelineWebUrl,
		pipelineJobs: ciInfo.jobs
	};
}

export const load: PageServerLoad = () => {
	const config = getConfig();

	const jiraPromise = fetchJiraWorkItems(config);
	const jiraStatusesPromise = fetchJiraProjectStatuses(config).catch(() => [] as string[]);
	const gitlabPromise = fetchGitLabMRs(config);
	const githubPromise = config.github.length > 0
		? fetchGitHubPRs(config)
		: Promise.resolve([] as UnifiedPR[]);

	const jiraStatus = resilient(jiraPromise.then((items) => ({ count: items.length })));
	const gitlabStatus = resilient(gitlabPromise.then((mrs) => ({ count: mrs.length })));
	const githubStatus = config.github.length > 0
		? resilient(githubPromise.then((prs) => ({ count: prs.length })))
		: Promise.resolve({ data: null, error: null } as ApiResult<null>);

	const gitlabVpnError: Promise<boolean> = gitlabPromise
		.then(() => false)
		.catch((err: unknown) => isGitLabUnavailable(err));

	const gitlabSafe: Promise<GitLabMR[]> = gitlabPromise.catch(() => []);
	const githubSafe: Promise<UnifiedPR[]> = githubPromise.catch(() => []);

	const rows: Promise<ApiResult<DashboardRow[]>> = resilient(
		Promise.all([jiraPromise, gitlabSafe, githubSafe]).then(
			async ([jiraItems, allGitLabMRs, allGitHubPRs]) => {
				return Promise.all(
					jiraItems.map(async (jiraItem) => {
						const matchingGitLabMRs = allGitLabMRs.filter((m) =>
							m.title.includes(jiraItem.key)
						);
						const matchingGitHubPRs = allGitHubPRs.filter((p) =>
							p.title.includes(jiraItem.key)
						);

						const [gitlabUnified, branches] = await Promise.all([
							Promise.all(
								matchingGitLabMRs.map(async (mr) => {
									const ciInfo = await fetchCIPipelineInfo(config, mr.iid).catch(
										() => ({ status: 'none' as const, pipelineId: null, pipelineWebUrl: null, jobs: [] })
									);
									return gitlabMRToUnifiedPR(mr, ciInfo);
								})
							),
							fetchGitLabBranches(config, jiraItem.key).catch(() => [] as string[])
						]);

						const prs: UnifiedPR[] = [...gitlabUnified, ...matchingGitHubPRs];

						return { jiraItem, prs, branches };
					})
				);
			}
		)
	);

	const reviews: Promise<ApiResult<ReviewItem[]>> = resilient(
		Promise.all([
			config.github.length > 0 ? fetchGitHubReviewRequests(config).catch(() => [] as ReviewItem[]) : Promise.resolve([] as ReviewItem[]),
			fetchGitLabReviewRequests(config).catch(() => [] as ReviewItem[])
		]).then(([gh, gl]) => [...gh, ...gl])
	);

	return {
		amplitudeOrgSlug: config.amplitude.orgSlug,
		githubConfigured: config.github.length > 0,
		jiraStatuses: config.jiraStatuses,
		prStatuses: config.prStatuses,
		streamed: {
			jiraStatus,
			gitlabStatus,
			githubStatus,
			gitlabVpnError,
			rows,
			reviews,
			jiraStatuses: jiraStatusesPromise
		}
	};
};
