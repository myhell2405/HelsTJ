'use strict';

const trackedDashboardStatuses = [
  { key: 'applied', label: 'Sudah dilamar', color: '#6643d5' },
  { key: 'in_process', label: 'Sedang diproses', color: '#21a179' },
  { key: 'rejected', label: 'Ditolak / tidak lolos', color: '#e16b6b' },
  { key: 'closed', label: 'Tutup / batal', color: '#8791a5' },
];

function renderStats() {
  const total = jobs.length;
  const trackedJobs = jobs.filter((job) => (
    trackedDashboardStatuses.some((status) => status.key === job.status)
  ));
  const tracked = trackedJobs.length;
  const untracked = total - tracked;
  const statusCounts = trackedDashboardStatuses.map((status) => ({
    ...status,
    count: trackedJobs.filter((job) => job.status === status.key).length,
  }));
  const percentages = statusCounts.map((status) => (
    tracked ? (status.count / tracked) * 100 : 0
  ));
  let end = 0;
  const slices = statusCounts.map((status, index) => {
    const start = end;
    end += percentages[index];
    return `${status.color} ${start}% ${end}%`;
  });
  const chartBackground = tracked
    ? `conic-gradient(${slices.join(', ')})`
    : 'conic-gradient(#e9eaf0 0% 100%)';
  const chartLabel = statusCounts
    .map((status) => `${status.label}: ${status.count}`)
    .join(', ');

  document.getElementById('stats').innerHTML = `
    <div class="overview-grid">
      <article class="overview-card untracked-card">
        <div class="overview-card-copy">
          <span class="overview-eyebrow">BELUM DI-TRACK</span>
          <strong class="overview-value">${untracked}</strong>
          <span class="overview-caption">lowongan belum dicentang</span>
        </div>
        <span class="overview-icon untracked-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></svg>
        </span>
      </article>
      <article class="overview-card total-card">
        <div class="overview-card-copy">
          <span class="overview-eyebrow">TOTAL LOWONGAN</span>
          <strong class="overview-value">${total}</strong>
          <span class="overview-caption">semua lowongan di tracker</span>
        </div>
        <span class="overview-icon total-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5v-12Z"/><path d="M4 6h13M8 10h8m-8 4h6"/></svg>
        </span>
      </article>
    </div>
    <section class="tracked-panel" aria-labelledby="trackedTitle">
      <div class="tracked-heading">
        <div>
          <span class="tracked-eyebrow">PROGRES LAMARAN</span>
          <h2 id="trackedTitle">Lowongan sudah di-track</h2>
          <p>Rincian hanya menghitung lowongan yang checklist-nya sudah dicentang.</p>
        </div>
        <span class="tracked-total">${tracked} <small>lowongan</small></span>
      </div>
      <div class="tracked-content">
        <div class="tracked-chart-wrap">
          <div class="tracked-chart" role="img" aria-label="Grafik status lowongan yang sudah di-track. ${chartLabel}." style="background:${chartBackground}">
            <div class="tracked-chart-center">
              <strong>${tracked}</strong>
              <span>di-track</span>
            </div>
          </div>
          <span class="chart-caption">Distribusi status</span>
        </div>
        <div class="status-breakdown" aria-label="Rincian status lowongan yang sudah di-track">
          ${statusCounts.map((status, index) => {
            const percent = percentages[index];
            return `
              <article class="status-card">
                <div class="status-card-heading">
                  <span class="status-name"><span class="status-dot" style="--status-color:${status.color}"></span>${status.label}</span>
                  <strong>${status.count}</strong>
                </div>
                <div class="status-progress" role="img" aria-label="${percent.toFixed(1)}% dari lowongan yang di-track">
                  <span style="width:${percent}%;--status-color:${status.color}"></span>
                </div>
                <span class="status-share">${percent.toFixed(1)}% dari yang di-track</span>
              </article>
            `;
          }).join('')}
        </div>
      </div>
    </section>
  `;
}

window.renderStats = renderStats;
renderStats();
