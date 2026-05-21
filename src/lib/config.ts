import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import { JIRA_TOKEN, GITLAB_TOKEN, GITHUB_TOKEN } from '$env/static/private';
import type { TeamMember } from '$lib/types';

export type TerminalChoice = 'Terminal' | 'iTerm2' | 'Warp';

interface YamlSettings {
	jira?: {
		baseUrl?: string;
		email?: string;
		projectKeys?: string[];
	};
	gitlab?: {
		baseUrl?: string;
		projectId?: number;
		repo?: string;
		authorUsername?: string;
	};
	github?: Array<{
		owner?: string;
		repo?: string;
		authorUsername?: string;
	}>;
	team?: TeamMember[];
	amplitude?: {
		baseUrl?: string;
		orgSlug?: string;
		projects?: Array<{
			name: string;
			envKey: string;
		}>;
	};
	jiraStatuses?: Array<{ label: string; colorToken: string }>;
	prStatuses?: string[];
	selfRepo?: { owner: string; repo: string };
	claudePrompt?: {
		default?: string;
		basePath?: string;
		prompts?: Record<string, { type: 'path' | 'text'; data: string }>;
	};
	repoPath?: {
		default?: string;
		repoPaths?: (string | { worktrees: string[] })[];
	};
	terminal?: {
		terminalChoice?: TerminalChoice;
		terminalConfigs?: {
			Terminal?: { shell: string };
			iTerm2?: { shell: string; profile: string };
			Warp?: { shell: string };
		};
	};
}

function loadSettings(): YamlSettings {
	let settings: YamlSettings;
	try {
		settings = parse(
			readFileSync(join(process.cwd(), 'settings.yml'), 'utf-8')
		) as YamlSettings;
	} catch {
		throw new Error('settings.yml not found — copy settings.yml.example and fill in required fields');
	}

	if (!settings.jira?.email) throw new Error('settings.yml: jira.email is required');
	if (!settings.team && !settings.gitlab?.authorUsername)
		throw new Error('settings.yml: gitlab.authorUsername is required (or define a team)');

	return settings;
}

export interface DashboardConfig {
	jira: {
		baseUrl: string;
		email: string;
		apiToken: string;
		projectKeys: string[];
	};
	gitlab: {
		baseUrl: string;
		token: string;
		projectId: number;
		repo: string;
		authorUsername: string;
	};
	github: Array<{
		token: string;
		owner: string;
		repo: string;
		authorUsername: string;
	}>;
	team: TeamMember[];
	amplitude: {
		baseUrl: string;
		orgSlug: string;
		projects: Array<{
			name: string;
			envKey: string;
		}>;
	};
	jiraStatuses: Array<{ label: string; colorToken: string }>;
	prStatuses: string[];
	selfRepo: { owner: string; repo: string } | null;
	claudePrompt: {
		default: string;
		basePath: string;
		prompts: Record<string, { type: 'path' | 'text'; data: string }>;
	};
	repoPath: {
		default: string;
		repoPaths: (string | { worktrees: string[] })[];
	};
	terminal: {
		terminalChoice: TerminalChoice;
		terminalConfigs: {
			Terminal: { shell: string };
			iTerm2: { shell: string; profile: string };
			Warp: { shell: string };
		};
	};
}

function buildTeam(settings: YamlSettings): TeamMember[] {
	if (settings.team && settings.team.length > 0) return settings.team;
	return [
		{
			jiraEmail: settings.jira?.email,
			gitlabAuthorUsername: settings.gitlab?.authorUsername,
			githubAuthorUsername: settings.github?.[0]?.authorUsername
		}
	];
}

export function getConfig(): DashboardConfig {
	const settings = loadSettings();
	return {
		team: buildTeam(settings),
		jira: {
			baseUrl: settings.jira!.baseUrl!,
			email: settings.jira!.email!,
			apiToken: JIRA_TOKEN,
			projectKeys: settings.jira!.projectKeys!
		},
		gitlab: {
			baseUrl: settings.gitlab!.baseUrl!,
			token: GITLAB_TOKEN,
			projectId: Number(settings.gitlab!.projectId),
			repo: settings.gitlab!.repo!,
			authorUsername: settings.gitlab!.authorUsername!
		},
		github: (settings.github ?? [])
			.filter((r) => r.owner && r.repo && r.authorUsername)
			.map((r) => ({
				token: GITHUB_TOKEN,
				owner: r.owner!,
				repo: r.repo!,
				authorUsername: r.authorUsername!
			})),
		amplitude: {
			baseUrl: settings.amplitude!.baseUrl!,
			orgSlug: settings.amplitude?.orgSlug ?? '',
			projects: settings.amplitude?.projects ?? []
		},
		jiraStatuses: settings.jiraStatuses ?? [],
		prStatuses: settings.prStatuses ?? [],
		selfRepo: settings.selfRepo?.owner && settings.selfRepo?.repo
			? { owner: settings.selfRepo.owner, repo: settings.selfRepo.repo }
			: null,
		claudePrompt: {
			default: settings.claudePrompt!.default!,
			basePath: settings.claudePrompt!.basePath!,
			prompts: settings.claudePrompt!.prompts!
		},
		repoPath: {
			default: settings.repoPath!.default!,
			repoPaths: settings.repoPath!.repoPaths!
		},
		terminal: {
			terminalChoice: settings.terminal!.terminalChoice!,
			terminalConfigs: {
				Terminal: settings.terminal!.terminalConfigs!.Terminal!,
				iTerm2: settings.terminal!.terminalConfigs!.iTerm2!,
				Warp: settings.terminal!.terminalConfigs!.Warp ?? { shell: 'zsh' }
			}
		}
	};
}
