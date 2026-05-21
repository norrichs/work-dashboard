<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Container from '$lib/components/Container.svelte';
	import Controls from '$lib/components/Controls.svelte';
	import Loader from '$lib/components/Loader.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import ReviewsTable from '$lib/components/ReviewsTable.svelte';
	import Button from '$lib/components/Button.svelte';
	import FlagSwitcher from '$lib/components/FlagSwitcher.svelte';
	import UpdateBanner from '$lib/components/UpdateBanner.svelte';
	import type { RenderMode } from '$lib/types';
	import type { PageData } from './$types';

	const DONE_STATUSES = ['Done', 'Closed', 'Resolved'];
	const STORAGE_KEY = 'dashboard-status-filters';

	let { data }: { data: PageData } = $props();
	let mode = $state<RenderMode>('compact');
	let gitlabVpnError = $state(false);
	let allStatuses = $state<string[]>([]);
	let enabledStatuses = $state<Set<string>>(new Set());
	let initialized = $state(false);

	$effect(() => {
		data.streamed.gitlabVpnError.then((v) => { gitlabVpnError = v; });
	});

	$effect(() => {
		data.streamed.jiraStatuses.then((statuses: string[]) => {
			if (statuses.length > 0) {
				allStatuses = statuses;
				if (!initialized) {
					initializeEnabledStatuses(statuses);
				}
			}
		});
	});

	function initializeEnabledStatuses(statuses: string[]) {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const parsed: string[] = JSON.parse(stored);
				enabledStatuses = new Set(parsed.filter((s) => statuses.includes(s)));
				initialized = true;
				return;
			}
		} catch {}
		enabledStatuses = new Set(statuses.filter((s) => !DONE_STATUSES.includes(s)));
		initialized = true;
	}

	function persistStatuses() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabledStatuses]));
		} catch {}
	}

	function handleReload() {
		invalidateAll();
	}

	function handleToggleStatus(status: string) {
		const next = new Set(enabledStatuses);
		if (next.has(status)) {
			next.delete(status);
		} else {
			next.add(status);
		}
		enabledStatuses = next;
		persistStatuses();
	}
</script>

<svelte:head>
	<title>Dashboard</title>
</svelte:head>

<UpdateBanner />
<Container>
	<Controls
		bind:mode
		onReload={handleReload}
		statuses={allStatuses}
		{enabledStatuses}
		onToggleStatus={handleToggleStatus}
		onSelectAll={() => { enabledStatuses = new Set(allStatuses); persistStatuses(); }}
		onDeselectAll={() => { enabledStatuses = new Set(); persistStatuses(); }}
	/>

	{#await data.streamed.rows}
		<Loader
			jiraStatus={data.streamed.jiraStatus}
			gitlabStatus={data.streamed.gitlabStatus}
			githubStatus={data.githubConfigured ? data.streamed.githubStatus : undefined}
		/>
	{:then result}
		{#if result.data !== null}
			<DataTable rows={result.data.filter((r) => enabledStatuses.has(r.jiraItem.status))} {mode} gitlabUnavailable={gitlabVpnError} jiraStatuses={data.jiraStatuses} prStatuses={data.prStatuses} />
		{:else}
			<div class="error-state">
				<p>Failed to load dashboard data.</p>
				<p class="error-detail">{result.error}</p>
				<Button variant="primary" label="Try again" onclick={handleReload} />
			</div>
		{/if}
	{/await}
</Container>

<Container>
	{#await data.streamed.reviews}
		<div class="reviews-loading">Loading reviews…</div>
	{:then result}
		{#if result.data !== null}
			<ReviewsTable reviews={result.data} />
		{:else}
			<div class="error-state">
				<p>Failed to load reviews.</p>
				<p class="error-detail">{result.error}</p>
			</div>
		{/if}
	{/await}
</Container>

<FlagSwitcher amplitudeOrgSlug={data.amplitudeOrgSlug} />

<style>
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 24px;
		gap: 8px;
		color: var(--color-text-muted);
	}

	.error-detail {
		font-size: 12px;
		color: var(--color-danger);
		font-family: monospace;
	}

	.reviews-loading {
		padding: 24px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 12px;
	}
</style>
