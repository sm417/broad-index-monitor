/* 宽基定投温度监控 · 前端 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const S = Object.assign(
  { v: 3, model: 'v2', window: 1250, wval: 0.3, base: 1000, step: 21, auto: 60, range: '5y' },
  JSON.parse(localStorage.getItem('wbcfg') || '{}')
);
if (S.v !== 3) { S.v = 3; S.range = '5y'; }
if (!['v1', 'v2'].includes(S.model)) S.model = 'v2';
const _qm = new URLSearchParams(location.search).get('model');
if (['v1', 'v2'].includes(_qm)) S.model = _qm;   // 允许用 ?model=v1 直接对照
if (!['1m', '3m', '6m', '1y', '3y', '5y', '10y', 'all'].includes(S.range)) S.range = '5y';
const save = () => localStorage.setItem('wbcfg', JSON.stringify(S));

let DATA = null;
let timer = null;
let curId = null;
let chartK = null, chartBT = null;

/* ---------- 工具 ---------- */
const nf = (n, d = 2) => (n == null || isNaN(n)) ? '—'
  : n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => (n == null || isNaN(n)) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
const plain = (n, d = 1) => (n == null || isNaN(n)) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
const wan = n => {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toFixed(0);
};
const toneOf = t => t < 25 ? 'ice' : t < 40 ? 'cool' : t < 65 ? 'mid' : t < 80 ? 'warm' : 'hot';
const labelOf = t => t < 25 ? '加码' : t < 40 ? '增额' : t < 65 ? '常规' : t < 80 ? '减额' : '缩量';
const multOf = t => t < 25 ? 2.0 : t < 40 ? 1.5 : t < 65 ? 1.0 : t < 80 ? 0.5 : 0.3;
const cls = n => n > 0 ? 'up' : n < 0 ? 'down' : 'flat';

/* ---------- 加载 ---------- */
async function load(force) {
  $('#stamp').textContent = '正在更新…';
  try {
    const r = await fetch(`/api/snapshot?window=${S.window}&wval=${S.wval}&model=${S.model}${force ? '&_=' + Date.now() : ''}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    DATA = await r.json();
    renderSummary(DATA);
    renderGrid(DATA);
    $('#stamp').textContent = '更新于 ' + DATA.updated.slice(5, 16);
    const h = (location.hash || '').replace('#', '');
    if (h && DATA.indices.some(x => x.id === h) && h !== curId) openDetail(h);
  } catch (e) {
    $('#stamp').textContent = '连接失败';
    $('#stamp').title = '检查服务端是否在运行：' + e.message;
  }
}

function renderSummary(d) {
  const ok = d.indices.filter(x => !x.error);
  const add = ok.filter(x => x.mult > 1).length;
  const cut = ok.filter(x => x.mult < 1).length;
  $('#sAdd').textContent = add + ' / ' + ok.length;
  $('#sHold').textContent = ok.length - add - cut;
  $('#sCut').textContent = cut;
  $('#sAvg').textContent = d.stats.avgScore == null ? '—' : (100 - d.stats.avgScore).toFixed(0);
}

/* ---------- 卡片 ---------- */
function renderGrid(d) {
  const g = $('#grid');
  g.innerHTML = '';
  d.indices.forEach(x => {
    const el = document.createElement('article');
    el.className = 'card';
    if (x.error) {
      el.innerHTML = `<div class="card-hd"><h3>${x.name}</h3></div>
        <p style="color:#b91c1c;font-size:12px;margin-top:10px">数据获取失败：${x.error}</p>`;
      g.appendChild(el);
      return;
    }
    const t = x.temp, tone = toneOf(t);
    el.dataset.tone = tone;
    el.dataset.id = x.id;
    const val = x.val || {};
    el.innerHTML = `
      <div class="card-hd">
        <div><h3>${x.name}<span class="mkt">${x.market}</span></h3></div>
        <div class="price"><b>${nf(x.price)}</b>
          <span class="chg ${cls(x.chgPct)}">${pct(x.chgPct, 2)}</span></div>
      </div>
      <div class="gauge">
        <div class="gauge-track"><i class="gauge-pin" style="left:${Math.max(1, Math.min(99, t))}%"></i></div>
      </div>
      <div class="verdict">
        <span class="mult">${x.mult.toFixed(1)}<span style="font-size:13px;font-weight:500">×</span></span>
        <span class="tag ${tone}">${labelOf(t)}</span>
        <em>本期 <b>¥${wan(S.base * x.mult)}</b></em>
      </div>
      <ul class="metrics">
        <li><span>${x.hasVal ? 'PE 分位' : '年内位置'}</span><b class="${x.hasVal ? '' : ''}">${x.hasVal ? (val.pePct * 100).toFixed(0) + '%' : (x.pos52 * 100).toFixed(0) + '%'}</b></li>
        <li><span>距高点</span><b>${plain(x.factors.dd.v * 100)}</b></li>
        <li><span>距 MA200</span><b>${plain(x.dev200)}</b></li>
        <li><span>距 10 年趋势</span><b>${plain(x.dev10)}</b></li>
      </ul>
      ${sparkSVG(x.spark)}`;
    el.onclick = () => openDetail(x.id);
    g.appendChild(el);
  });
}

function sparkSVG(arr) {
  if (!arr || arr.length < 2) return '';
  const w = 300, h = 34, pad = 3;
  const mn = Math.min(...arr), mx = Math.max(...arr), sp = mx - mn || 1;
  const pts = arr.map((v, i) => [pad + i * (w - pad * 2) / (arr.length - 1),
                                  h - pad - (v - mn) / sp * (h - pad * 2)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${w - pad} ${h} L${pad} ${h} Z`;
  const up = arr[arr.length - 1] >= arr[0];
  const c = up ? '#d92d20' : '#0d9f6e';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="g${up ? 'u' : 'd'}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#g${up ? 'u' : 'd'})"/>
    <path d="${line}" fill="none" stroke="${c}" stroke-width="1.4" stroke-opacity=".75"
      stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ---------- 详情 ---------- */
async function openDetail(id) {
  const x = DATA.indices.find(i => i.id === id);
  if (!x || x.error) return;
  curId = id;
  const t = x.temp, tone = toneOf(t);
  $('#dName').textContent = x.name;
  $('#dMeta').textContent = `${x.code} · ${x.market} · ${x.since} 起 · ${x.bars.toLocaleString()} 个交易日`;
  $('#dMeta').title = x.note || '';
  $('#dPrice').textContent = nf(x.price);
  $('#dChg').textContent = pct(x.chgPct, 2);
  $('#dChg').className = cls(x.chgPct);

  const val = x.val || {};
  const pctOf = v => x.hasVal ? `<span style="color:var(--ink3);margin-left:3px">(${(v * 100).toFixed(0)}%)</span>` : '';
  $('#dVerdict').innerHTML = `
    <span class="big">本期建议 <span style="color:var(--accent)">${x.mult.toFixed(1)}×</span></span>
    <span class="tag ${tone}">${labelOf(t)}</span>
    <span class="sep"></span>
    <span class="kv">温度<b>${t.toFixed(0)}</b></span>
    <span class="kv">PE<b>${x.hasVal ? val.pe.toFixed(2) : '—'}</b>${x.hasVal ? pctOf(val.pePct) : ''}</span>
    <span class="kv">PB<b>${x.hasVal ? val.pb.toFixed(2) : '—'}</b>${x.hasVal ? pctOf(val.pbPct) : ''}</span>
    <span class="kv" style="margin-left:auto">¥${wan(S.base)} × ${x.mult.toFixed(1)} ＝ <b>¥${wan(S.base * x.mult)}</b></span>`;

  renderFactors(x);
  $('#modal').classList.add('on');
  await Promise.all([loadK(id, S.range), loadBT(id)]);
  requestAnimationFrame(() => { chartK && chartK.resize(); chartBT && chartBT.resize(); });
}

function renderFactors(x) {
  const fmtv = { pct: v => plain(v * 100), pct0: v => (v * 100).toFixed(0) + '%', num: v => v.toFixed(1) };
  let rows = Object.keys(x.factors).map(k => {
    const f = x.factors[k];
    const fn = fmtv[f.fmt] || fmtv.pct;
    return `<tr><td>${f.label}</td><td>${fn(f.v)}</td>
      <td><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
        <div class="bar" style="width:96px"><i style="width:${f.s.toFixed(0)}%"></i></div>
        <span style="width:26px">${f.s.toFixed(0)}</span></div></td>
      <td>${(f.w * 100).toFixed(0)}%</td></tr>`;
  }).join('');
  $('#dFactors').innerHTML = `<table>
    <thead><tr><th>因子</th><th>读数</th><th>位置分</th><th>权重</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderRangeStats(d) {
  const k = d.k || [];
  if (!k.length) { $('#rangeStats').innerHTML = ''; return; }
  const first = k[0][1], last = k[k.length - 1][1];
  const chg = (last / first - 1) * 100;
  const hi = Math.max(...k.map(x => x[3]));
  const lo = Math.min(...k.map(x => x[2]));
  const spanDays = (new Date(d.dates[d.dates.length - 1]) - new Date(d.dates[0])) / 86400000;
  const yrs = spanDays / 365.25;
  const cagr = yrs > 0.6 ? (Math.pow(last / first, 1 / yrs) - 1) * 100 : null;
  $('#rangeStats').innerHTML = `
    <span class="chg ${cls(chg)}">区间 ${pct(chg, 2)}</span>
    ${cagr == null ? '' : `<span>年化 <b class="${cls(cagr)}">${pct(cagr, 2)}</b></span>`}
    <span>区间最高 <b>${nf(hi)}</b></span>
    <span>区间最低 <b>${nf(lo)}</b></span>
    <span class="dim">${d.dates[0]} → ${d.dates[d.dates.length - 1]} · ${k.length} 日</span>
    ${d.hasVol === false ? '<span class="dim">· 无成交额数据</span>' : ''}`;
}

async function loadK(id, range) {
  const el = $('#chartK');
  chartK = chartK || echarts.init(el);
  chartK.showLoading({ text: '', color: '#1f5eff', maskColor: 'rgba(255,255,255,.6)' });
  const r = await fetch(`/api/kline?id=${id}&range=${range}`);
  const d = await r.json();
  chartK.hideLoading();
  renderRangeStats(d);
  const axis = {
    type: 'category', data: d.dates, boundaryGap: false,
    axisLine: { lineStyle: { color: '#e6e9ef' } },
    axisLabel: { color: '#8c95a3', fontSize: 11 }, axisTick: { show: false }
  };
  const hasVol = d.hasVol !== false;   // 纳斯达克官网历史无成交量
  // 均线配色沿用国内行情软件的习惯（短周期暖色、长周期冷色），避开涨红跌绿以免误读
  const MA_STYLE = {
    5:   { color: '#f97316', w: 1 },
    10:  { color: '#eab308', w: 1 },
    20:  { color: '#a855f7', w: 1.1 },
    60:  { color: '#0891b2', w: 1.2 },
    200: { color: '#2563eb', w: 1.5 }
  };
  const periods = d.maPeriods || [60, 200];
  const maSeries = periods.map(p => {
    const st = MA_STYLE[p] || { color: '#94a3b8', w: 1 };
    return {
      name: 'MA' + p, type: 'line', data: (d.ma || {})['ma' + p] || [],
      symbol: 'none', smooth: true, connectNulls: false,
      // 图例色块取的是 series 的 itemStyle.color，必须显式给，否则会回落成 ECharts 默认调色板
      itemStyle: { color: st.color },
      lineStyle: { width: st.w, color: st.color },
      emphasis: { focus: 'series' }
    };
  });
  chartK.setOption({
    animation: false,
    legend: {
      data: maSeries.map(s => s.name), left: 52, top: 0, itemWidth: 14, itemHeight: 2, itemGap: 12,
      icon: 'roundRect', textStyle: { color: '#6b7280', fontSize: 11 }, inactiveColor: '#c9cdd6'
    },
    grid: hasVol
      ? [{ left: 52, right: 16, top: 34, height: '58%' }, { left: 52, right: 16, top: '78%', height: '12%' }]
      : [{ left: 52, right: 16, top: 34, bottom: 46 }],
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(255,255,255,.96)', borderColor: '#e6e9ef',
      textStyle: { color: '#14181f', fontSize: 12 },
      formatter: (ps) => {
        if (!ps || !ps.length) return '';
        let s = `<div style="font-size:11px;color:#8c95a3;margin-bottom:4px">${ps[0].axisValue}</div>`;
        ps.forEach(p => {
          let txt;
          if (p.seriesType === 'candlestick') {
            const v = p.value.length > 4 ? p.value.slice(1) : p.value;   // [o,c,l,h]
            const up = v[1] >= v[0];
            txt = `开 ${nf(v[0])} 高 ${nf(v[3])} 低 ${nf(v[2])} 收 <b class="${up ? 'up' : 'down'}">${nf(v[1])}</b>`;
          } else if (p.seriesName === '成交额') {
            const v = p.value || 0;
            txt = v >= 1e12 ? (v / 1e12).toFixed(2) + '万亿'
                : v >= 1e8 ? (v / 1e8).toFixed(1) + '亿'
                : v >= 1e4 ? (v / 1e4).toFixed(0) + '万' : String(v);
          } else {
            txt = p.value == null ? '—' : nf(p.value);
          }
          s += `<div style="display:flex;justify-content:space-between;gap:18px;font-size:12px;line-height:1.75">
                  <span>${p.marker}${p.seriesName}</span><span style="font-variant-numeric:tabular-nums">${txt}</span></div>`;
        });
        return s;
      }
    },
    xAxis: hasVol ? [axis, Object.assign({}, axis, { gridIndex: 1, axisLabel: { show: false } })] : [axis],
    yAxis: hasVol ? [
      { scale: true, position: 'left', splitLine: { lineStyle: { color: '#f1f3f8' } },
        axisLabel: { color: '#8c95a3', fontSize: 11 }, axisLine: { show: false } },
      { scale: true, gridIndex: 1, splitNumber: 1, axisLabel: { show: false },
        axisLine: { show: false }, splitLine: { show: false } }
    ] : [
      { scale: true, position: 'left', splitLine: { lineStyle: { color: '#f1f3f8' } },
        axisLabel: { color: '#8c95a3', fontSize: 11 }, axisLine: { show: false } }
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: hasVol ? [0, 1] : [0], start: 0, end: 100 },
               { type: 'slider', xAxisIndex: hasVol ? [0, 1] : [0], bottom: 4, height: 16, start: 0, end: 100,
                 borderColor: 'transparent',
                 backgroundColor: '#f4f6fa', fillerColor: 'rgba(31,94,255,.08)',
                 handleStyle: { color: '#1f5eff' }, textStyle: { color: '#8c95a3', fontSize: 10 } }],
    series: [
      { name: 'K', type: 'candlestick', data: d.k,
        itemStyle: { color: '#d92d20', color0: '#0d9f6e', borderColor: '#d92d20', borderColor0: '#0d9f6e' } }
    ].concat(maSeries).concat(hasVol ? [
      { name: '成交额', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: d.vol,
        itemStyle: { color: 'rgba(31,94,255,.18)' } }
    ] : [])
  }, true);
}

async function loadBT(id) {
  const el = $('#chartBT');
  chartBT = chartBT || echarts.init(el);
  chartBT.showLoading({ text: '', color: '#1f5eff', maskColor: 'rgba(255,255,255,.6)' });
  const r = await fetch(`/api/backtest?id=${id}&window=${S.window}&base=${S.base}&step=${S.step}&model=${S.model}`);
  const d = await r.json();
  chartBT.hideLoading();
  if (d.error) {
    $('#btCards').innerHTML = `<p style="color:#b91c1c;font-size:12px">${d.error}</p>`;
    return;
  }
  const s = d.sig, q = d.eq;
  const wr = o => o.budget ? (o.wealth / o.budget).toFixed(2) + '×' : '—';
  $('#btHint').textContent = `${d.dates[0]} 起 · ${d.times} 期 · 同预算 ${wan(d.budget / d.times)}/期`;
  $('#btCards').innerHTML = `
    <div class="bt-card"><label>按信号 · 平均 ${s.multAvg}×</label>
      <b class="sig">${s.xirr == null ? '—' : s.xirr.toFixed(2) + '%'}<span style="font-size:11px;font-weight:400;color:#8c95a3"> 年化</span></b>
      <div style="font-size:11px;color:#8c95a3;line-height:1.6;margin-top:2px">
        同预算财富 <b style="color:var(--ink)">${wr(s)}</b> · 最大浮亏 ${s.maxFloatLoss.toFixed(1)}%<br>
        实投 ${wan(s.invested)} · 存现金 ${wan(s.cash)}</div></div>
    <div class="bt-card"><label>等额定投</label>
      <b class="eq">${q.xirr == null ? '—' : q.xirr.toFixed(2) + '%'}<span style="font-size:11px;font-weight:400;color:#8c95a3"> 年化</span></b>
      <div style="font-size:11px;color:#8c95a3;line-height:1.6;margin-top:2px">
        同预算财富 <b style="color:var(--ink)">${wr(q)}</b> · 最大浮亏 ${q.maxFloatLoss.toFixed(1)}%<br>
        实投 ${wan(q.invested)} · 存现金 ${wan(q.cash)}</div></div>`;
  chartBT.setOption({
    animation: false,
    grid: { left: 54, right: 12, top: 26, bottom: 24 },
    tooltip: {
      trigger: 'axis', backgroundColor: 'rgba(255,255,255,.96)', borderColor: '#e6e9ef',
      textStyle: { color: '#14181f', fontSize: 12 },
      valueFormatter: v => wan(v)
    },
    legend: { show: true, right: 4, top: 0, itemWidth: 12, itemHeight: 2, textStyle: { color: '#8c95a3', fontSize: 11 } },
    xAxis: { type: 'category', data: d.dates, boundaryGap: false, axisLine: { lineStyle: { color: '#e6e9ef' } },
      axisLabel: { color: '#8c95a3', fontSize: 10 }, axisTick: { show: false } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#f1f3f8' } },
      axisLabel: { color: '#8c95a3', fontSize: 10, formatter: v => wan(v) } },
    series: [
      { name: '信号·市值', type: 'line', data: d.value, symbol: 'none', smooth: true,
        lineStyle: { width: 2, color: '#1f5eff' },
        areaStyle: { color: 'rgba(31,94,255,.08)' } },
      { name: '等额·市值', type: 'line', data: d.valueEq, symbol: 'none', smooth: true,
        lineStyle: { width: 1.4, color: '#94a3b8', type: 'dashed' } },
      { name: '信号·累计投入', type: 'line', data: d.invested, symbol: 'none', smooth: true,
        lineStyle: { width: 1, color: 'rgba(31,94,255,.35)' } }
    ]
  }, true);
}

/* ---------- 交互 ---------- */
function closeAll() {
  $('#modal').classList.remove('on');
  $('#drawer').classList.remove('on');
  $('#help').classList.remove('on');
}
$$('[data-close]').forEach(b => b.onclick = closeAll);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

$('#btnRefresh').onclick = () => load(true);
$('#btnSettings').onclick = () => $('#drawer').classList.add('on');
$('#btnHelp').onclick = () => $('#help').classList.add('on');

$$('#ranges button').forEach(b => {
  b.classList.toggle('on', b.dataset.r === S.range);
  b.onclick = () => {
    $$('#ranges button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    S.range = b.dataset.r; save();
    if (curId) loadK(curId, S.range);
  };
});

function bindSeg(sel, key, cast, after) {
  $$(sel + ' button').forEach(b => {
    if (String(S[key]) === b.dataset.v) {
      $$(sel + ' button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    }
    b.onclick = () => {
      $$(sel + ' button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S[key] = cast(b.dataset.v); save();
      if (after) after();
    };
  });
}
bindSeg('#segWindow', 'window', Number, () => load());
bindSeg('#segStep', 'step', Number, () => { if (curId) loadBT(curId); });
bindSeg('#segAuto', 'auto', Number, () => setAuto());
bindSeg('#segModel', 'model', String, () => { syncModelUI(); load(); if (curId) loadBT(curId); });

function syncModelUI() {
  const v2 = S.model === 'v2';
  $$('#segModel button').forEach(b => b.classList.toggle('on', b.dataset.v === S.model));
  ['#fldWindow', '#fldWval'].forEach(sel => {
    const el = $(sel);
    el.style.opacity = v2 ? .42 : 1;
    el.style.pointerEvents = v2 ? 'none' : '';
  });
  $('#modelHint').textContent = v2
    ? '价格位置改为「相对 200 日线的偏离分位」，创历史新高不再直接判为「贵」。'
    : '旧版：按「价格在分位窗口内的位置」打分，长期上行的指数会被系统性判贵。';
}
syncModelUI();

const wv = $('#wVal'), wvt = $('#wValTxt');
wv.value = Math.round(S.wval * 100);
wvt.textContent = wv.value + '%';
wv.oninput = () => { wvt.textContent = wv.value + '%'; };
wv.onchange = () => { S.wval = wv.value / 100; save(); load(); };

const ba = $('#baseAmt');
ba.value = S.base;
ba.onchange = () => {
  const v = Math.max(100, Number(ba.value) || 1000);
  S.base = v; ba.value = v; save();
  if (curId) loadBT(curId);
};

function setAuto() {
  if (timer) clearInterval(timer);
  if (S.auto > 0) timer = setInterval(() => load(), S.auto * 1000);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
window.addEventListener('resize', () => { chartK && chartK.resize(); chartBT && chartBT.resize(); });

/* ---------- 启动 ---------- */
$('#grid').innerHTML = Array(11).fill('<div class="skeleton"></div>').join('');
load();
setAuto();
