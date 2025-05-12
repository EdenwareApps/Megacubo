<script>
	import { onMount, tick } from "svelte";

	let {
		items = $bindable(),
		height = $bindable(),
		width = $bindable(),
		itemWidth = $bindable(),
		itemHeight = $bindable(),
		range = $bindable(),
		isTop = $bindable(),
		isBottom = $bindable(),
		refresh = $bindable(() => {})
	} = $props();

	let mounted = $state(false);
	let scrollTop = $state(0);
	let viewport_height = $state(0);
	let viewport_width = $state(0);
	let visible = $state([]);
	let top = $state(0);
	let bottom = $state(0);
	let scrollHeight = $state(0);

	let viewport;
	let contents;

	function getItemsDimensionsMatrix() {
		const itemsLength = items.length;

		if (itemsLength === 0) {
			range = { start: 0, end: -1, renderStart: 0, renderEnd: 0 };
			visible = [];
			top = 0;
			bottom = 0;
			scrollHeight = 0;
			return { rows: [], y_positions: [] };
		}

		let rows = [];
		let currentRow = [];
		let cumulative_width = 0;

		for (let i = 0; i < itemsLength; i++) {
			const width = itemWidth(items[i], i) || 100;
			cumulative_width += width;
			if (cumulative_width > viewport_width) {
				rows.push(currentRow);
				currentRow = [];
				cumulative_width = width;
			}
			currentRow.push(i);
		}
		if (currentRow.length > 0) rows.push(currentRow);

		const row_heights = rows.map((row) => {
			return Math.max(
				...row.map((index) => itemHeight(items[index], index) || 100),
			);
		});
		const y_positions = [0];
		let cumulative_height = 0;
		for (let h of row_heights) {
			cumulative_height += h;
			y_positions.push(cumulative_height);
		}

		return { rows, y_positions };
	}

	refresh = async () => {
		await tick();
		viewport_height = viewport.offsetHeight || viewport_height;
		viewport_width = viewport.offsetWidth || viewport_width;

		if (!items || !Array.isArray(items)) {
			console.log("Invalid or undefined items", { items });
			range = { start: 0, end: -1, renderStart: 0, renderEnd: 0 };
			visible = [];
			top = 0;
			bottom = 0;
			scrollHeight = 0;
			return;
		}

		const { rows, y_positions } = getItemsDimensionsMatrix();
		const tolerance = 20;

		let row_start = 0;	
		while (
			row_start < rows.length &&
			y_positions[row_start + 1] <= (scrollTop + tolerance)
		) {
			row_start++;
		}

		let row_end = row_start;
		const scrollBottom = scrollTop + viewport_height - tolerance;
		while (row_end < rows.length && y_positions[row_end] < scrollBottom) {
			row_end++;
		}
		row_end = Math.min(rows.length - 1, row_end);

		let render_row_start = Math.max(0, row_start - 1);
		let render_row_end = Math.min(rows.length - 1, row_end + 1);
		
		if (!rows.length) {
			range = { start: 0, end: -1, renderStart: 0, renderEnd: 0 };
			visible = [];
			top = 0;
			bottom = 0;
			scrollHeight = 0;
			return;
		}

		range = {
			renderStart: rows[render_row_start][0],
			renderEnd: rows[render_row_end][rows[render_row_end].length - 1],
			start: rows[row_start][0],
			end: rows[row_end][rows[row_end].length - 1]
		};

		top = y_positions[render_row_start];
		bottom = y_positions[rows.length] - y_positions[render_row_end + 1];

		isTop = scrollTop < tolerance;
		isBottom = scrollTop >= (y_positions[rows.length] - viewport_height - tolerance);

		visible = items
			.slice(range.renderStart, range.renderEnd + 1)
			.map((data, i) => ({ index: i + range.renderStart, data }));
		scrollHeight = y_positions[rows.length];
	}

	export async function scrollToIndex(index) {
		const { rows, y_positions } = getItemsDimensionsMatrix();

		let index_row = 0;
		while (index_row < rows.length) {
			if (index <= rows[index_row][rows[index_row].length - 1]) {
				break;
			}
			index_row++;
		}

		const top = y_positions[index_row];
		console.error('scrollToIndex', index, {top, rows, y_positions, scrollTop, viewport_height})
		if(top < scrollTop || top > (scrollTop + viewport_height)) {
			let element;
			while (!element) {
				element = document.querySelector('[tabindex="'+ index +'"]')
				console.log('waiting for tabindex="'+ index +'" '+ viewport.scrollTop +' => '+ top)
				viewport.style.scrollSnapType = 'none'
				viewport.scrollTop = scrollTop = top
				await tick();
				await refresh();
			}
			setTimeout(() => {
				viewport.style.scrollSnapType = 'y mandatory';
			}, 100);
			return true;
		}
	}

	async function handle_scroll() {
		scrollTop = viewport.scrollTop;
		await refresh();
	}

	onMount(async () => {
		mounted = true;
		await tick();
		await refresh();
	});

	$effect(() => {
		if (mounted) {
			refresh();
		}
	});
</script>

<svelte-virtual-grid-viewport
	bind:this={viewport}
	onscroll={handle_scroll}
	style="height: {height}; width: {width};"
>
	<svelte-virtual-grid-contents
		bind:this={contents}
		style="padding-top: {top}px; padding-bottom: {bottom}px;"
	>
		{#each visible as row (row.index)}
			<slot item={row.data}></slot>
		{/each}
	</svelte-virtual-grid-contents>
</svelte-virtual-grid-viewport>

<style>
	svelte-virtual-grid-viewport {
		position: relative;
		overflow-y: auto;
		overflow-x: hidden;
		display: block;
	}

	svelte-virtual-grid-contents {
		display: grid;
	}

	*[slot="item"],
	slot {
		overflow: hidden;
	}
</style>
