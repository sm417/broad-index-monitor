/* 宽基定投温度监控 · 前端 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const S = Object.assign(
  { v: 2, window: 1250, wval: 0.3, base: 1000, step: 21, auto: 60, range: '5y' },
  JSON.parse(localStorage.getItem('wbcfg') || '{}')
);
if (S.v !== 2) { S.v = 2; S.range = '5y'; }
if (!['1y', '3y', '5y', '10y', 'all'].includes(S.range)) S.range = '5y';
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
    const r = await fetch(`/api/snapshot?window=${S.window}&wval=${S.wval}${force ? '&_=' + Date.now() : ''}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    DATA = await r.json();
    renderSummary(DATA);
    renderGrid(DATA);
    $('#stamp').textContent = '数据时间 ' + DATA.updated;
    const h = (location.hash || '').replace('#', '');
    if (h && DATA.indices.some(x => x.id === h) && h !== curId) openDetail(h);
  } catch (e) {
    $('#stamp').textContent = '连接失败 · 检查服务端是否在运行（' + e.message + '）';
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
  $('#sAvg').nextElementSibling.textContent = `温度越低越该加码 · ${ok.length} 只宽基`;
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
        <div class="gauge-scale"><span>冷 · 便宜</span><span>中性</span><span>热 · 贵</span></div>
      </div>
      <div class="verdict">
        <span class="mult">${x.mult.toFixed(1)}<span style="font-size:14px;font-weight:500">×</span></span>
        <span class="tag ${tone}">${labelOf(t)}</span>
        <em>温度 ${t.toFixed(0)} ｜ 本期 ¥${wan(S.base * x.mult)}</em>
      </div>
      <ul class="metrics">
        <li><span>PE 分位</span><b class="${x.hasVal ? '' : 'na'}">${x.hasVal ? (val.pePct * 100).toFixed(0) + '%' : '无数据'}</b></li>
        <li><span>价格分位</span><b>${(x.factors.pct.v * 100).toFixed(0)}%</b></li>
        <li><span>距历史高</span><b>${plain(x.factors.dd.v * 100)}</b></li>
        <li><span>距 200 日线</span><b>${plain(x.factors.ma.v * 100)}</b></li>
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
  $('#dMeta').textContent = `${x.code} · ${x.market} · ${x.date} 收盘 · 历史 ${x.bars} 个交易日（${x.since} 起）`
    + (x.note ? ' · ' + x.note : '');
  $('#dPrice').textContent = nf(x.price);
  $('#dChg').textContent = pct(x.chgPct, 2);
  $('#dChg').className = cls(x.chgPct);

  const val = x.val || {};
  $('#dVerdict').innerHTML = `
    <span class="big">本期建议 <span style="color:var(--accent)">${x.mult.toFixed(1)}×</span></span>
    <span class="tag ${tone}">${labelOf(t)}</span>
    <span class="sep"></span>
    <span class="kv">温度<b>${t.toFixed(0)}</b></span>
    <span class="kv">位置分<b>${x.posScore.toFixed(0)}</b></span>
    <span class="kv">估值分<b>${x.hasVal ? x.valScore.toFixed(0) : '无'}</b></span>
    <span class="sep"></span>
    <span class="kv">PE<b>${x.hasVal ? val.pe.toFixed(2) : '—'}</b></span>
    <span class="kv">PB<b>${x.hasVal ? val.pb.toFixed(2) : '—'}</b></span>
    <span class="kv">PE分位<b>${x.hasVal ? (val.pePct * 100).toFixed(0) + '%' : '—'}</b></span>
    <span class="kv">PB分位<b>${x.hasVal ? (val.pbPct * 100).toFixed(0) + '%' : '—'}</b></span>
    <span class="kv" style="margin-left:auto">按基准 ${wan(S.base)} × ${x.mult.toFixed(1)} ＝ <b>${wan(S.base * x.mult)}</b></span>`;

  renderFactors(x);
  $('#modal').classList.add('on');
  await Promise.all([loadK(id, S.range), loadBT(id)]);
  requestAnimationFrame(() => { chartK && chartK.resize(); chartBT && chartBT.resize(); });
}

function renderFactors(x) {
  const order = ['pct', 'dd', 'ma', 'rsi', 'mom'];
  const fmtv = {
    pct: v => (v * 100).toFixed(0) + '%', dd: v => plain(v * 100),
    ma: v => plain(v * 100), rsi: v => v.toFixed(1), mom: v => plain(v * 100)
  };
  let rows = order.map(k => {
    const f = x.factors[k];
    return `<tr><td>${f.label}</td><td>${fmtv[k](f.v)}</td>
      <td><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
        <div class="bar" style="width:96px"><i style="width:${f.s.toFixed(0)}%"></i></div>
        <span style="width:26px">${f.s.toFixed(0)}</span></div></td>
      <td>${(f.w * 100).toFixed(0)}%</td></tr>`;
  }).join('');
  if (x.hasVal) {
    rows += `<tr><td>估值（PE ${x.val.pe.toFixed(1)} / PB ${x.val.pb.toFixed(2)}）</td>
      <td>PE分位 ${(x.val.pePct * 100).toFixed(0)}% · PB分位 ${(x.val.pbPct * 100).toFixed(0)}%</td>
      <td><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
        <div class="bar" style="width:96px"><i style="width:${x.valScore.toFixed(0)}%"></i></div>
        <span style="width:26px">${x.valScore.toFixed(0)}</span></div></td>
      <td>${(S.wval * 100).toFixed(0)}%</td></tr>`;
  }
  $('#dFactors').innerHTML = `<table>
    <thead><tr><th>因子</th><th>当前读数</th><th>位置分（越高越便宜）</th><th>权重</th></tr></thead>
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
    <span class="dim">${d.dates[0]} → ${d.dates[d.dates.length - 1]}（${k.length} 个交易日）</span>`;
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
  chartK.setOption({
    animation: false,
    grid: [{ left: 52, right: 16, top: 18, height: '62%' }, { left: 52, right: 16, top: '80%', height: '12%' }],
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(255,255,255,.96)', borderColor: '#e6e9ef',
      textStyle: { color: '#14181f', fontSize: 12 }
    },
    xAxis: [axis, Object.assign({}, axis, { gridIndex: 1, axisLabel: { show: false } })],
    yAxis: [
      { scale: true, position: 'left', splitLine: { lineStyle: { color: '#f1f3f8' } },
        axisLabel: { color: '#8c95a3', fontSize: 11 }, axisLine: { show: false } },
      { scale: true, gridIndex: 1, splitNumber: 1, axisLabel: { show: false },
        axisLine: { show: false }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
               { type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 16, start: 0, end: 100,
                 borderColor: 'transparent',
                 backgroundColor: '#f4f6fa', fillerColor: 'rgba(31,94,255,.08)',
                 handleStyle: { color: '#1f5eff' }, textStyle: { color: '#8c95a3', fontSize: 10 } }],
    series: [
      { name: 'K', type: 'candlestick', data: d.k,
        itemStyle: { color: '#d92d20', color0: '#0d9f6e', borderColor: '#d92d20', borderColor0: '#0d9f6e' } },
      { name: 'MA60', type: 'line', data: d.ma60, symbol: 'none', smooth: true,
        lineStyle: { width: 1, color: '#f59e0b' } },
      { name: 'MA200', type: 'line', data: d.ma200, symbol: 'none', smooth: true,
        lineStyle: { width: 1.2, color: '#3b82f6' } },
      { name: '成交额', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: d.vol,
        itemStyle: { color: 'rgba(31,94,255,.18)' } }
    ]
  }, true);
}

async function loadBT(id) {
  const el = $('#chartBT');
  chartBT = chartBT || echarts.init(el);
  chartBT.showLoading({ text: '', color: '#1f5eff', maskColor: 'rgba(255,255,255,.6)' });
  const r = await fetch(`/api/backtest?id=${id}&window=${S.window}&base=${S.base}&step=${S.step}`);
  const d = await r.json();
  chartBT.hideLoading();
  if (d.error) {
    $('#btCards').innerHTML = `<p style="color:#b91c1c;font-size:12px">${d.error}</p>`;
    return;
  }
  const s = d.sig, q = d.eq;
  $('#btHint').textContent = `${d.dates[0]} 起 · ${d.times} 期 · 比年化，不比市值`;
  $('#btCards').innerHTML = `
    <div class="bt-card"><label>按信号 · 平均 ${s.multAvg}×</label>
      <b class="sig">${s.xirr == null ? '—' : s.xirr.toFixed(2) + '%'}<span style="font-size:11px;font-weight:400;color:#8c95a3"> 年化</span></b>
      <div style="font-size:11px;color:#8c95a3;line-height:1.6;margin-top:2px">
        投入 ${wan(s.invested)} → 期末 ${wan(s.value)}<br>
        总收益 ${pct(s.profitPct)} · 最大浮亏 ${s.maxFloatLoss.toFixed(1)}%</div></div>
    <div class="bt-card"><label>等额定投</label>
      <b class="eq">${q.xirr == null ? '—' : q.xirr.toFixed(2) + '%'}<span style="font-size:11px;font-weight:400;color:#8c95a3"> 年化</span></b>
      <div style="font-size:11px;color:#8c95a3;line-height:1.6;margin-top:2px">
        投入 ${wan(q.invested)} → 期末 ${wan(q.value)}<br>
        总收益 ${pct(q.profitPct)} · 最大浮亏 ${q.maxFloatLoss.toFixed(1)}%</div></div>`;
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
}
$$('[data-close]').forEach(b => b.onclick = closeAll);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

$('#btnRefresh').onclick = () => load(true);
$('#btnSettings').onclick = () => $('#drawer').classList.add('on');

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
$('#grid').innerHTML = Array(10).fill('<div class="skeleton"></div>').join('');
load();
setAuto();
