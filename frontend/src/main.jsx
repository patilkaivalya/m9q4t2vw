import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const fmt = (n, digits = 0) => n == null ? '—' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const dates = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
const shortDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 14 4-4 4 3 6-7"/></>,
    rows: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="2" cy="6" r=".7"/><circle cx="2" cy="12" r=".7"/><circle cx="2" cy="18" r=".7"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></>,
    wind: <><path d="M3 8h12a3 3 0 1 0-3-3"/><path d="M2 12h17a3 3 0 1 1-3 3"/><path d="M4 16h6a2 2 0 1 1-2 2"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function TrendChart({ rows }) {
  const width = 760, height = 238, pad = { left: 46, right: 14, top: 16, bottom: 31 };
  if (!rows.length) return <div className="chart-empty">No matched forecast and actual periods for this day.</div>;
  const values = rows.flatMap((r) => [r.forecastMw, r.actualMw]);
  const max = Math.ceil(Math.max(...values) / 500) * 500 || 1000;
  const min = Math.max(0, Math.floor(Math.min(...values) / 500) * 500 - 500);
  const x = (i) => pad.left + i * (width - pad.left - pad.right) / Math.max(rows.length - 1, 1);
  const y = (v) => height - pad.bottom - (v - min) * (height - pad.top - pad.bottom) / Math.max(max - min, 1);
  const line = (key) => rows.map((r, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(' ');
  const yTicks = Array.from({ length: 4 }, (_, i) => min + ((max - min) * i / 3));
  const xTicks = [0, 8, 16, 24, 32, 40, 47].filter((i) => i < rows.length);
  return <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Actual and forecast wind generation across the selected day">
    {yTicks.map((v, i) => <g key={i}><line x1={pad.left} x2={width-pad.right} y1={y(v)} y2={y(v)} className="gridline"/><text x={pad.left-9} y={y(v)+4} textAnchor="end" className="axis-label">{(v/1000).toFixed(1)}k</text></g>)}
    {xTicks.map((i) => <g key={i}><line x1={x(i)} x2={x(i)} y1={height-pad.bottom} y2={height-pad.bottom+4} className="tick"/><text x={x(i)} y={height-7} textAnchor="middle" className="axis-label">{String(Math.floor(i/2)).padStart(2,'0')}:00</text></g>)}
    <path d={line('forecastMw')} className="line-forecast"/><path d={line('actualMw')} className="line-actual"/>
    {rows.map((r,i)=><circle key={r.settlementPeriod} cx={x(i)} cy={y(r.actualMw)} r="2.5" className="point-actual"><title>{r.localStartTime.slice(11,16)} · actual {fmt(r.actualMw)} MW</title></circle>)}
  </svg>;
}

function AccuracyBars({ days, selected, onSelect }) {
  const max = Math.max(100, ...days.map((d) => d.maeMw || 0));
  return <div className="bars" role="list" aria-label="Daily mean absolute error. Select a day to inspect it.">
    {days.map((day) => <button key={day.date} role="listitem" title={`${shortDate(day.date)}: ${fmt(day.maeMw)} MW MAE`} className={`bar-slot ${day.date === selected ? 'selected' : ''}`} onClick={() => onSelect(day.date)}>
      <span className="bar-value" style={{ height: `${Math.max(4, (day.maeMw || 0) / max * 100)}%` }} />
      <span className="bar-day">{day.date.slice(-2)}</span>
    </button>)}
  </div>;
}

function App() {
  const [summary, setSummary] = useState(null);
  const [series, setSeries] = useState(null);
  const [selected, setSelected] = useState('2026-01-15');
  const [loading, setLoading] = useState(true);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeNav, setActiveNav] = useState('overview');
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/wind/summary?month=2026-01').then((r) => { if (!r.ok) throw new Error(`Elexon request failed (${r.status})`); return r.json(); })
      .then(setSummary).catch((e) => setError(e.message || 'Could not load the wind data.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    setSeriesLoading(true);
    fetch(`/api/wind/series?date=${selected}`).then((r) => { if (!r.ok) throw new Error(`Could not load ${selected}`); return r.json(); })
      .then(setSeries).catch((e) => setError(e.message || 'Could not load the selected day.')).finally(() => setSeriesLoading(false));
  }, [selected]);

  const shownRows = useMemo(() => (series?.periods || []).filter((r) => `${r.settlementPeriod} ${r.localStartTime} ${r.forecastMw} ${r.actualMw}`.toLowerCase().includes(query.toLowerCase())), [series, query]);
  const overall = summary?.overall;
  const daily = summary?.daily || [];
  const selectedDay = daily.find((d) => d.date === selected);
  const selectedIndex = dates.indexOf(selected);
  const refreshTime = summary?.refreshedAt ? new Date(summary.refreshedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

  function navTo(id) { setActiveNav(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function changeDate(offset) { setSelected(dates[Math.min(30, Math.max(0, selectedIndex + offset))]); }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="wind" size={21}/></div><div><strong>northgrid</strong><small>ENERGY ANALYTICS</small></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {[['overview','grid','Overview'],['accuracy','chart','Forecast accuracy'],['periods','rows','Settlement periods']].map(([id,icon,label])=><button key={id} className={`nav-item ${activeNav===id?'active':''}`} onClick={()=>navTo(id)}><Icon name={icon}/><span>{label}</span>{id==='periods'&&<span className="nav-count">48</span>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="source-chip"><span className="live-dot"/><div><b>Data source</b><span>Elexon Insights API</span></div></div><div className="profile"><div className="avatar">UK</div><div><b>GB System</b><span>National portfolio</span></div><span className="more">···</span></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="crumb">Portfolio <span>/</span> Wind generation</div><div className="top-actions"><span className="period-pill">JAN <b>2026</b></span><a className="export-button" href="/api/wind/export.csv"><Icon name="download" size={16}/> Export data</a></div></header>
      <section className="page-heading" id="overview"><div><div className="eyebrow"><span className="green-line"/> DAY-AHEAD PROCUREMENT · GREAT BRITAIN</div><h1>Wind forecast desk</h1><p>See the wind outlook used for day-ahead decisions, and how it tracked against actual generation.</p></div><div className="updated"><span className="live-dot"/><span>January 2026 historical view</span></div></section>
      {error && <div className="error-banner"><b>Data connection issue</b><span>{error}. Check the API and refresh.</span><button onClick={()=>location.reload()}>Retry</button></div>}

      <section className="scorecard-section" aria-labelledby="score-title">
        <div className="section-head"><div><span className="eyebrow">MONTHLY SCORECARD</span><h2 id="score-title">Forecast performance</h2></div><span className="sample-note">{loading ? 'Loading Elexon data…' : `${fmt(overall?.periods)} matched half-hours`}</span></div>
        <div className="metric-grid">
          <Metric title="Mean absolute error" value={overall?.maeMw} unit="MW" explanation="Typical size of the forecast miss" icon="↕" loading={loading}/>
          <Metric title="Root mean squared error" value={overall?.rmseMw} unit="MW" explanation="Weights larger misses more heavily" icon="⌁" loading={loading}/>
          <Metric title="Forecast bias" value={overall?.biasMw} unit="MW" explanation="+ means wind was over-forecast" icon="±" loading={loading} bias/>
          <Metric title="Weighted absolute error" value={overall?.wapePct} unit="%" explanation="Absolute error ÷ actual generation" icon="%" loading={loading} percent/>
        </div>
      </section>

      <section className="panel accuracy-panel" id="accuracy">
        <div className="panel-heading"><div><span className="eyebrow">DAY VIEW</span><h2>Forecast vs actual</h2><p>Half-hourly actuals matched to the latest eligible wind forecast.</p></div><div className="date-controls"><button aria-label="Previous delivery day" onClick={()=>changeDate(-1)} disabled={selectedIndex===0}>‹</button><input aria-label="Delivery date" type="date" min="2026-01-01" max="2026-01-31" value={selected} onChange={(e)=>e.target.value&&setSelected(e.target.value)}/><button aria-label="Next delivery day" onClick={()=>changeDate(1)} disabled={selectedIndex===30}>›</button></div></div>
        <div className="chart-meta"><div className="legend"><span><i className="legend-actual"/> Actual generation</span><span><i className="legend-forecast"/> Day-ahead forecast</span></div><span className="units">MW · Europe/London</span></div>
        <div className={`chart-wrap ${seriesLoading?'dimmed':''}`}><TrendChart rows={series?.periods || []}/></div>
        <div className="chart-footer"><span><Icon name="clock" size={15}/> Forecast cutoff: <b>10:00, day before delivery</b></span><span>{selectedDay ? `${selectedDay.periods} of 48 periods matched` : 'Waiting for data'}</span></div>
      </section>

      <section className="panel daily-panel">
        <div className="panel-heading compact"><div><span className="eyebrow">JANUARY AT A GLANCE</span><h2>Daily forecast error</h2></div><div className="micro-legend"><i/> MAE, MW</div></div>
        <AccuracyBars days={daily} selected={selected} onSelect={setSelected}/>
        <div className="bar-axis"><span>1 Jan</span><span>15 Jan</span><span>31 Jan</span></div>
      </section>

      <section className="panel table-panel" id="periods">
        <div className="panel-heading table-heading"><div><span className="eyebrow">DELIVERY DETAIL</span><h2>Settlement periods <span className="heading-date">· {shortDate(selected)}</span></h2><p>Forecast error is forecast minus actual. Positive values indicate over-forecast wind.</p></div><label className="search-box"><span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Filter periods" aria-label="Filter settlement periods"/></label></div>
        <div className="table-scroll"><table><thead><tr><th>TIME (LONDON)</th><th>SP</th><th>FORECAST PUBLISHED</th><th className="number">FORECAST</th><th className="number">ACTUAL</th><th className="number">ERROR</th></tr></thead><tbody>
          {shownRows.map((row)=><tr key={row.startTime}><td className="time-cell">{row.localStartTime.slice(11,16)}</td><td><span className="sp-tag">{row.settlementPeriod}</span></td><td className="muted-cell">{new Date(row.forecastPublishTime).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'})}</td><td className="number">{fmt(row.forecastMw)}</td><td className="number actual-cell">{fmt(row.actualMw)}</td><td className={`number ${row.errorMw>0?'error-up':row.errorMw<0?'error-down':''}`}>{row.errorMw>0?'+':''}{fmt(row.errorMw)}</td></tr>)}
          {!shownRows.length && <tr><td colSpan="6" className="empty-row">{seriesLoading?'Loading settlement periods…':'No periods match this filter.'}</td></tr>}
        </tbody></table></div>
        <div className="table-footer"><span>Showing {shownRows.length} of {series?.periods?.length || 0} periods</span><span>Source: Elexon FUELHH + WINDFOR</span></div>
      </section>
      <footer className="footer-note"><span>Northgrid · Wind forecast desk</span><span>Forecast horizon uses the last publication available before 10:00 London time, day-ahead.</span></footer>
    </main>
  </div>;
}

function Metric({ title, value, unit, explanation, icon, loading, bias, percent }) {
  const display = loading ? '···' : value == null ? '—' : `${bias && value > 0 ? '+' : ''}${fmt(value, percent ? 1 : 0)}`;
  const tone = bias && value != null ? value > 0 ? 'warm' : value < 0 ? 'cool' : '' : '';
  return <article className="metric-card"><div className="metric-top"><span>{title}</span><span className="metric-icon">{icon}</span></div><div className={`metric-value ${tone}`}>{display}<small>{unit}</small></div><div className="metric-foot">{explanation}</div></article>;
}

createRoot(document.getElementById('root')).render(<App/>);
