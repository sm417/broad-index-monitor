# -*- coding: utf-8 -*-
"""
宽基定投温度监控 · 本地服务端
数据源：东方财富（日线行情，含当日实时）、蛋卷基金（指数 PE/PB 历史分位）
"""
import json
import os
import sys
import time
import threading
import socket
import webbrowser
import urllib.request
import urllib.parse
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
UA_EM = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
         "Referer": "https://quote.eastmoney.com/"}
UA_DJ = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
         "Referer": "https://danjuanfunds.com/"}
UA_NQ = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
         "Accept": "application/json, text/plain, */*",
         "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}

# ---------------------------------------------------------------- 监控标的
INDICES = [
    dict(id="hs300",  name="沪深300",    code="000300", secid="1.000300",  dj="SH000300", market="A股", note=""),
    dict(id="zz500",  name="中证500",    code="000905", secid="1.000905",  dj="SH000905", market="A股", note=""),
    dict(id="zz1000", name="中证1000",   code="000852", secid="1.000852",  dj="SH000852", market="A股", note=""),
    dict(id="cyb50",  name="创业板50",   code="399673", secid="0.399673",  dj=None,       market="A股", note="2014-06 指数发布"),
    dict(id="kc50",   name="科创50",     code="000688", secid="1.000688",  dj="SH000688", market="A股", note="2020-07 发布，此前为基日回溯"),
    dict(id="a500",   name="中证A500",   code="000510", secid="1.000510",  dj=None,       market="A股", note="2024年9月发布，此前为回溯数据"),
    dict(id="sz50",   name="上证50",     code="000016", secid="1.000016",  dj="SH000016", market="A股", note=""),
    dict(id="spx",    name="标普500",    code="SPX",    secid="100.SPX",   dj=None,       market="美股", note=""),
    dict(id="ndx",    name="纳斯达克100", code="NDX",   secid="100.NDX100", dj="NDX",     market="美股",
         note="长历史＝纳斯达克官网 + 东财拼接（无成交额）", long="nasdaq"),
    dict(id="hstech", name="恒生科技",   code="HSTECH", secid="124.HSTECH", dj="HKHSTECH", market="港股", note="2014-12 基日"),
]

KLINE_TTL = 120      # 行情缓存 2 分钟
VAL_TTL = 1800       # 估值缓存 30 分钟
HIST_TTL = 21600     # 长历史（纳斯达克官网）缓存 6 小时
_cache = {"kline": {}, "val": {}, "t": {}, "hist": {}}
_lock = threading.Lock()
POOL = ThreadPoolExecutor(max_workers=8)


# ---------------------------------------------------------------- 抓取
def _get(url, hdr, tries=2, timeout=20):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=hdr)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:
            last = e
            time.sleep(0.6 * (i + 1))
    raise last


def fetch_kline(secid):
    key = secid
    now = time.time()
    with _lock:
        hit = _cache["kline"].get(key)
        if hit and now - hit[0] < KLINE_TTL:
            return hit[1]
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=%s"
           "&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57"
           "&klt=101&fqt=1&beg=19900101&end=20500101" % secid)
    d = json.loads(_get(url, UA_EM))["data"]
    rows = []
    for k in d.get("klines") or []:
        p = k.split(",")
        rows.append(dict(d=p[0], o=float(p[1]), c=float(p[2]), h=float(p[3]),
                         l=float(p[4]), v=float(p[5]), a=float(p[6])))
    with _lock:
        _cache["kline"][key] = (now, rows)
    return rows


def fetch_nasdaq_hist(sym):
    """纳斯达克官网指数日线：NDX 自 1996-06-06 起，无成交量字段。
    该接口只给到最近一个已收盘交易日，实时尾巴由东财补齐。"""
    key = "nq:" + sym
    now = time.time()
    with _lock:
        hit = _cache["hist"].get(key)
        if hit and now - hit[0] < HIST_TTL:
            return hit[1]
    end = date.fromordinal(date.today().toordinal() + 3).isoformat()
    url = ("https://api.nasdaq.com/api/quote/%s/historical?assetclass=index"
           "&fromdate=1985-01-01&limit=20000&todate=%s" % (sym, end))
    d = json.loads(_get(url, UA_NQ, timeout=40))
    rows = []
    for x in d.get("data", {}).get("tradesTable", {}).get("rows") or []:
        try:
            mm, dd, yy = x["date"].split("/")
            num = lambda s: float(str(s).replace("$", "").replace(",", ""))
            rows.append(dict(d="%s-%s-%s" % (yy, mm, dd),
                             o=num(x["open"]), c=num(x["close"]),
                             h=num(x["high"]), l=num(x["low"]), v=0.0, a=0.0))
        except Exception:
            continue
    rows.reverse()
    with _lock:
        _cache["hist"][key] = (now, rows)
    return rows


def fetch_kline_ix(ix):
    """按标的取日线：默认东财；带 long="nasdaq" 的先用官网长历史打底，再用东财覆盖近端（含盘中）。"""
    rows = fetch_kline(ix["secid"])
    if not ix.get("long") or not rows:
        return rows
    key = "merge:" + ix["id"]
    now = time.time()
    with _lock:
        hit = _cache["hist"].get(key)
        if hit and now - hit[0] < KLINE_TTL:
            return hit[1]
    try:
        old = fetch_nasdaq_hist(ix["code"])
    except Exception as e:
        sys.stderr.write("[warn] %s 长历史获取失败，退回东财：%s\n" % (ix["name"], e))
        old = []
    if old:
        first = rows[0]["d"]
        rows = [r for r in old if r["d"] < first] + rows
    with _lock:
        _cache["hist"][key] = (now, rows)
    return rows


def fetch_val(dj):
    if not dj:
        return None
    now = time.time()
    with _lock:
        hit = _cache["val"].get(dj)
        if hit and now - hit[0] < VAL_TTL:
            return hit[1]
    try:
        t = json.loads(_get("https://danjuanfunds.com/djapi/index_eva/detail/%s" % dj, UA_DJ))
    except Exception:
        return None
    d = t.get("data") or {}
    out = None
    if d.get("pe") is not None:
        out = dict(pe=d.get("pe"), pb=d.get("pb"),
                   pePct=d.get("pe_percentile"), pbPct=d.get("pb_percentile"),
                   roe=d.get("roe"), yeild=d.get("yeild"),
                   ts=datetime.fromtimestamp(d["ts"] / 1000).strftime("%Y-%m-%d") if d.get("ts") else None,
                   src="蛋卷基金")
    with _lock:
        _cache["val"][dj] = (now, out)
    return out


# ---------------------------------------------------------------- 指标
def clamp(x, lo=0.0, hi=100.0):
    return max(lo, min(hi, x))


def pct_rank(vals, x):
    if not vals:
        return 0.5
    return sum(1 for v in vals if v <= x) / len(vals)


def rsi(closes, n=14):
    if len(closes) < n + 1:
        return 50.0
    gain = loss = 0.0
    for i in range(len(closes) - n, len(closes)):
        ch = closes[i] - closes[i - 1]
        if ch >= 0:
            gain += ch
        else:
            loss -= ch
    if gain + loss == 0:
        return 50.0
    rs = (gain / n) / (loss / n) if loss > 0 else 999
    return 100 - 100 / (1 + rs)


def window_slice(closes, i, window):
    """window=0 表示全历史"""
    if not window:
        return closes[: i + 1]
    return closes[max(0, i - window + 1): i + 1]


def pos_factors(closes, i, window):
    """只用 i 及之前的数据，杜绝未来函数"""
    sub = window_slice(closes, i, window)
    cur = closes[i]
    pct = pct_rank(sub, cur)
    ath = max(closes[: i + 1])
    dd = cur / ath - 1.0
    ma200 = sum(closes[max(0, i - 199): i + 1]) / len(closes[max(0, i - 199): i + 1])
    dev = cur / ma200 - 1.0
    r = rsi(closes[: i + 1], 14)
    mom60 = (cur / closes[i - 60] - 1.0) if i >= 60 else 0.0

    f = {
        "pct": dict(v=pct, s=clamp(100 - pct * 100), w=0.30, label="价格分位"),
        "dd": dict(v=dd, s=clamp(abs(dd) / 0.50 * 100), w=0.25, label="距历史高点"),
        "ma": dict(v=dev, s=clamp(50 - dev * 250), w=0.20, label="200日线偏离"),
        "rsi": dict(v=r, s=clamp((70 - r) / 40 * 100), w=0.15, label="RSI(14)"),
        "mom": dict(v=mom60, s=clamp(50 - mom60 * 150), w=0.10, label="60日动量"),
    }
    score = sum(x["s"] * x["w"] for x in f.values())
    return score, f


# 倍率档位：一律按「温度」（0 冷 = 便宜，100 热 = 贵）切分，前后端同一口径
BANDS = [(80, 0.3, "缩量", "hot"), (65, 0.5, "减额", "warm"),
         (40, 1.0, "常规", "mid"), (25, 1.5, "增额", "cool"), (-1, 2.0, "加码", "ice")]


def band_from_temp(t):
    for lo, mult, label, tone in BANDS:
        if t >= lo:
            return dict(mult=mult, label=label, tone=tone)
    return dict(mult=1.0, label="常规", tone="mid")


def band_of(score):
    """score 越高越便宜 → 温度 = 100 - score"""
    return band_from_temp(100 - score)


# ---------------------------------------------------------------- 快照
def build_snapshot(window=1250, w_val=0.30):
    """window: 交易日数量，0=全历史；w_val: 估值权重"""
    def one(ix):
        try:
            rows = fetch_kline_ix(ix)
        except Exception as e:
            return dict(id=ix["id"], name=ix["name"], error=str(e))
        if not rows:
            return dict(id=ix["id"], name=ix["name"], error="无数据")
        closes = [r["c"] for r in rows]
        last, prev = closes[-1], closes[-2] if len(closes) > 1 else closes[-1]
        i = len(closes) - 1
        p_score, f = pos_factors(closes, i, window)
        val = fetch_val(ix["dj"])

        v_score = None
        if val and val.get("pePct") is not None and val.get("pbPct") is not None:
            v_score = clamp(100 - (val["pePct"] * 0.5 + val["pbPct"] * 0.5) * 100)

        if v_score is not None and w_val > 0:
            total = p_score * (1 - w_val) + v_score * w_val
        else:
            total = p_score
        band = band_of(total)

        hi52 = max(closes[-250:])
        lo52 = min(closes[-250:])
        return dict(
            id=ix["id"], name=ix["name"], code=ix["code"], market=ix["market"], note=ix["note"],
            price=last, chg=last - prev, chgPct=(last / prev - 1) * 100 if prev else 0,
            date=rows[-1]["d"], since=rows[0]["d"], bars=len(rows),
            score=round(total, 1), posScore=round(p_score, 1),
            temp=round(100 - total, 1),
            valScore=None if v_score is None else round(v_score, 1),
            mult=band["mult"], label=band["label"], tone=band["tone"],
            factors={k: dict(v=x["v"], s=round(x["s"], 1), w=x["w"], label=x["label"])
                     for k, x in f.items()},
            pctWindow=window,
            hi52=hi52, lo52=lo52, pos52=(last - lo52) / (hi52 - lo52) if hi52 > lo52 else 0.5,
            val=val, hasVal=v_score is not None,
            spark=[round(x, 2) for x in closes[-60:]],
        )

    out = list(POOL.map(one, INDICES))
    out.sort(key=lambda x: (x.get("score") if x.get("score") is not None else 50))
    ok = [x for x in out if "error" not in x]
    return dict(
        updated=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        window=window, wVal=w_val,
        indices=out,
        stats=dict(n=len(ok),
                   add=len([x for x in ok if x["mult"] > 1]),
                   hold=len([x for x in ok if x["mult"] == 1]),
                   cut=len([x for x in ok if x["mult"] < 1]),
                   avgScore=round(sum(x["score"] for x in ok) / len(ok), 1) if ok else None),
    )


# ---------------------------------------------------------------- 回测
def xirr(flows):
    """flows: [(date, amount)]  负=投入，正=期末市值"""
    if not flows:
        return None
    t0 = flows[0][0]

    def npv(r):
        return sum(a / ((1 + r) ** ((d - t0).days / 365.0)) for d, a in flows)

    lo, hi = -0.9999, 10.0
    try:
        if npv(lo) * npv(hi) > 0:
            return None
        for _ in range(200):
            mid = (lo + hi) / 2
            if npv(mid) > 0:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2
    except Exception:
        return None


def backtest(ix, window=1250, base=1000, step=21):
    rows = fetch_kline_ix(ix)
    if len(rows) < 300:
        return dict(error="历史不足")
    dates = [datetime.strptime(r["d"], "%Y-%m-%d").date() for r in rows]
    closes = [r["c"] for r in rows]

    start = 250
    t_dates, t_mult, inv_sig, inv_eq, val_sig, val_eq = [], [], [], [], [], []
    units_s, units_e = 0.0, 0.0
    cum_s, cum_e = 0.0, 0.0
    flows_s, flows_e = [], []

    i = start
    while i < len(closes):
        score, _ = pos_factors(closes, i, window or 0)
        mult = band_of(score)["mult"]
        px = closes[i]
        a_s, a_e = base * mult, base
        cum_s += a_s
        cum_e += a_e
        units_s += a_s / px
        units_e += a_e / px
        flows_s.append((dates[i], -a_s))
        flows_e.append((dates[i], -a_e))
        t_dates.append(rows[i]["d"])
        t_mult.append(mult)
        inv_sig.append(round(cum_s, 2))
        inv_eq.append(round(cum_e, 2))
        val_sig.append(round(units_s * px, 2))
        val_eq.append(round(units_e * px, 2))
        i += step

    if not t_dates:
        return dict(error="样本不足")

    flows_s.append((dates[-1], units_s * closes[-1]))
    flows_e.append((dates[-1], units_e * closes[-1]))
    m_s = dict(
        invested=round(cum_s, 2), value=round(units_s * closes[-1], 2),
        profitPct=round((units_s * closes[-1] / cum_s - 1) * 100, 2),
        xirr=None, avgCost=round(cum_s / units_s, 2), multAvg=round(cum_s / (base * len(t_dates)), 2),
        maxFloatLoss=round(min(v / inv - 1 for v, inv in zip(val_sig, inv_sig)) * 100, 2),
    )
    m_e = dict(
        invested=round(cum_e, 2), value=round(units_e * closes[-1], 2),
        profitPct=round((units_e * closes[-1] / cum_e - 1) * 100, 2),
        avgCost=round(cum_e / units_e, 2),
        maxFloatLoss=round(min(v / inv - 1 for v, inv in zip(val_eq, inv_eq)) * 100, 2),
    )
    r = xirr(flows_s)
    m_s["xirr"] = None if r is None else round(r * 100, 2)
    r2 = xirr(flows_e)
    m_e["xirr"] = None if r2 is None else round(r2 * 100, 2)
    m_e["multAvg"] = 1.0
    return dict(
        dates=t_dates, mult=t_mult,
        invested=inv_sig, value=val_sig, investedEq=inv_eq, valueEq=val_eq,
        sig=m_s, eq=m_e, times=len(t_dates),
        window=window, base=base, step=step,
    )


MA_PERIODS = (5, 10, 20, 60, 200)


def build_kline(ix, rng="5y"):
    allrows = fetch_kline_ix(ix)
    n = {"1m": 21, "3m": 63, "6m": 126, "1y": 250,
         "3y": 750, "5y": 1250, "10y": 2500}.get(rng, 0)
    # 均线在全历史上滚动计算后再切片，否则短区间里 MA200 会整条为空。
    # 用前缀和，任意周期都是 O(n)，不必每个周期各扫一遍。
    closes_all = [r["c"] for r in allrows]
    pre = [0.0]
    for c in closes_all:
        pre.append(pre[-1] + c)
    mas = {}
    for p in MA_PERIODS:
        arr = [None] * len(closes_all)
        for i in range(p - 1, len(closes_all)):
            arr[i] = round((pre[i + 1] - pre[i + 1 - p]) / p, 2)
        mas["ma%d" % p] = arr
    rows = allrows
    if n and len(allrows) > n:
        rows = allrows[-n:]
        mas = {k: v[-n:] for k, v in mas.items()}
    vol = [r["v"] for r in rows]
    out = dict(id=ix["id"], name=ix["name"],
               dates=[r["d"] for r in rows],
               k=[[r["o"], r["c"], r["l"], r["h"]] for r in rows],
               vol=vol, hasVol=bool(vol) and all(v for v in vol),
               since=rows[0]["d"], bars=len(rows),
               ma={k: v for k, v in mas.items()}, maPeriods=list(MA_PERIODS))
    out.update(mas)          # 兼容旧的 ma60 / ma200 字段
    return out


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # 允许 file:// 打开的本地启动页探测服务是否在线
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if u.path == "/api/snapshot":
                w = int(q.get("window", 1250))
                wv = float(q.get("wval", 0.30))
                return self._json(build_snapshot(w, wv))
            if u.path == "/api/kline":
                ix = next((x for x in INDICES if x["id"] == q.get("id")), None)
                if not ix:
                    return self._json({"error": "unknown id"}, 404)
                return self._json(build_kline(ix, q.get("range", "5y")))
            if u.path == "/api/backtest":
                ix = next((x for x in INDICES if x["id"] == q.get("id")), None)
                if not ix:
                    return self._json({"error": "unknown id"}, 404)
                w = int(q.get("window", 1250))
                base = float(q.get("base", 1000))
                step = int(q.get("step", 21))
                return self._json(backtest(ix, w, base, step))
            if u.path == "/api/meta":
                return self._json(dict(indices=[{k: x[k] for k in ("id", "name", "code", "market", "note")}
                                                for x in INDICES]))
            if u.path == "/api/health":
                return self._json(dict(ok=True, ts=datetime.now().isoformat()))
        except Exception as e:
            return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 500)
        return super().do_GET()


DEFAULT_PORT = 8766          # 优先固定端口，保证「宽基监控.url」不会失效


def free_port(start=DEFAULT_PORT):
    for p in range(start, start + 30):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return start


def main():
    port = free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://127.0.0.1:%d/index.html" % port
    # 每次启动都把真实地址写回「网址.txt」，端口顺延时也不会指向旧地址
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "网址.txt"),
                  "w", encoding="utf-8") as f:
            f.write(url + "\n")
    except Exception:
        pass
    print("宽基定投温度监控已启动：%s" % url)
    print("关闭此窗口即停止服务。")
    if not os.environ.get("WB_NO_OPEN"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
