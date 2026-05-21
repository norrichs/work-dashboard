<script lang="ts">
	import Table from './Table.svelte';
	import TableHeaderRow from './TableHeaderRow.svelte';
	import TableBodyRow from './TableBodyRow.svelte';
	import BadgeButton from './BadgeButton.svelte';
	import type { ReviewItem, ReviewState } from '$lib/types';

	interface Props {
		reviews: ReviewItem[];
	}

	let { reviews }: Props = $props();

	function openLink(url: string) {
		window.open(url, '_blank', 'noopener');
	}

	function stateLabel(s: ReviewState): string {
		if (s === 'pending') return 'Pending';
		if (s === 'approved') return 'Approved';
		if (s === 'changes_requested') return 'Changes requested';
		return 'Commented';
	}

	function stateColorToken(s: ReviewState): string {
		if (s === 'approved') return 'success';
		if (s === 'changes_requested') return 'danger';
		if (s === 'commented') return 'primary';
		return 'warning';
	}

	function prLabel(r: ReviewItem): string {
		return `${r.source === 'gitlab' ? '!' : '#'}${r.id}`;
	}
</script>

<div class="reviews-header">
	<h2>My Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}</h2>
</div>

<Table>
	<TableHeaderRow>
		<th class="col-source"></th>
		<th class="col-id">MR / PR</th>
		<th>Title</th>
		<th class="col-author">Author</th>
		<th class="col-state">My state</th>
	</TableHeaderRow>
	<tbody>
		{#each reviews as r (`${r.source}-${r.repo}-${r.id}`)}
			<TableBodyRow>
				<td class="col-source">
					<span class={`pr-source-badge pr-source-${r.source}`}>
						{r.source === 'gitlab' ? 'GL' : 'GH'}
					</span>
				</td>
				<td class="col-id">
					<BadgeButton
						label={prLabel(r)}
						colorToken="primary"
						onclick={() => openLink(r.webUrl)}
					/>
				</td>
				<td class="title-cell">
					<button class="title-link" onclick={() => openLink(r.webUrl)} title={r.title}>
						{r.title}
					</button>
				</td>
				<td class="col-author">{r.author}</td>
				<td class="col-state">
					<span class={`badge badge-${stateColorToken(r.myReviewState)}`}>
						{stateLabel(r.myReviewState)}
					</span>
				</td>
			</TableBodyRow>
		{/each}
		{#if reviews.length === 0}
			<TableBodyRow>
				<td colspan="5" class="empty-state">No PRs waiting on you.</td>
			</TableBodyRow>
		{/if}
	</tbody>
</Table>

<style>
	.reviews-header {
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
	}

	.reviews-header h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	th {
		text-align: left;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		white-space: nowrap;
		padding: 8px 12px;
	}

	td {
		border-bottom: 1px solid var(--color-border);
		padding: 8px 12px;
		vertical-align: middle;
	}

	.col-source { width: 32px; padding-right: 0; }
	.col-id { width: 90px; }
	.col-author { width: 140px; color: var(--color-text-muted); font-size: 12px; }
	.col-state { width: 160px; }

	.title-cell {
		overflow: hidden;
	}

	.title-link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--color-text);
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
		display: inline-block;
	}

	.title-link:hover {
		color: var(--color-primary);
	}

	.pr-source-badge {
		display: inline-block;
		font-size: 10px;
		font-weight: 600;
		padding: 1px 5px;
		border-radius: 3px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.pr-source-github {
		background: var(--color-gray-muted);
		color: var(--color-text);
	}

	.pr-source-gitlab {
		background: #fc6d26;
		color: white;
	}

	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: var(--radius);
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
	}

	.badge-primary { background: var(--color-primary-muted); color: var(--color-primary); }
	.badge-success { background: var(--color-success-muted); color: var(--color-success); }
	.badge-warning { background: var(--color-warning-muted); color: var(--color-warning); }
	.badge-danger { background: var(--color-danger-muted); color: var(--color-danger); }

	.empty-state {
		text-align: center;
		padding: 24px;
		color: var(--color-text-muted);
		font-size: 12px;
	}
</style>
