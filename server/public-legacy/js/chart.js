// Minimal dependency-free SVG line chart for the weight trend.

function renderWeightChart(containerEl, points, goalWeight) {
  containerEl.innerHTML = '';
  if (!points || points.length === 0) {
    containerEl.innerHTML = '<p class="empty-hint">Log a weight entry to see your trend chart.</p>';
    return;
  }

  const width = containerEl.clientWidth || 600;
  const height = 260;
  const padding = { top: 20, right: 20, bottom: 30, left: 44 };

  const sorted = points.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const weights = sorted.map(p => p.weight);
  let minW = Math.min(...weights, goalWeight || Infinity);
  let maxW = Math.max(...weights);
  if (minW === maxW) { minW -= 5; maxW += 5; }
  const pad = (maxW - minW) * 0.1 || 5;
  minW -= pad;
  maxW += pad;

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const xFor = (i) => padding.left + (sorted.length === 1 ? innerW / 2 : (i / (sorted.length - 1)) * innerW);
  const yFor = (w) => padding.top + innerH - ((w - minW) / (maxW - minW)) * innerH;

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Weight trend chart">`;

  // gridlines + y labels (4 rows)
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const w = minW + ((maxW - minW) * s) / steps;
    const y = yFor(w);
    svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid" />`;
    svg += `<text x="${padding.left - 8}" y="${y + 4}" class="chart-axis-label" text-anchor="end">${Math.round(w)}</text>`;
  }

  // goal line
  if (goalWeight) {
    const gy = yFor(goalWeight);
    svg += `<line x1="${padding.left}" y1="${gy}" x2="${width - padding.right}" y2="${gy}" class="chart-goal-line" />`;
    svg += `<text x="${width - padding.right}" y="${gy - 6}" class="chart-axis-label goal" text-anchor="end">Goal ${goalWeight}</text>`;
  }

  // line path
  const pathD = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.weight)}`).join(' ');
  svg += `<path d="${pathD}" class="chart-line" fill="none" />`;

  // points
  sorted.forEach((p, i) => {
    svg += `<circle cx="${xFor(i)}" cy="${yFor(p.weight)}" r="4" class="chart-point"><title>${p.date}: ${p.weight} lbs</title></circle>`;
  });

  // x labels: first and last date only, to avoid crowding
  svg += `<text x="${xFor(0)}" y="${height - 8}" class="chart-axis-label" text-anchor="start">${sorted[0].date}</text>`;
  if (sorted.length > 1) {
    svg += `<text x="${xFor(sorted.length - 1)}" y="${height - 8}" class="chart-axis-label" text-anchor="end">${sorted[sorted.length - 1].date}</text>`;
  }

  svg += '</svg>';
  containerEl.innerHTML = svg;
}
