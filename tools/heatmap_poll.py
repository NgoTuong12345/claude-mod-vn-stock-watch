"""Poll Vietstock market heatmap (all stocks). Usage: python heatmap_poll.py [interval_s] [n_polls]
Session-carried: GET page -> cookie + __RequestVerificationToken -> POST /data/GetStockByGICS.
Site itself polls every 15s (SignalR push is the alternative, see api-contract)."""
import re, sys, time, json, requests

BASE = "https://finance.vietstock.vn"
ALL = "Tất cả"
FORM = {"filter[exchangeId]": 0, "filter[exchange][id]": 0, "filter[exchange][text]": ALL,
        "filter[sectorId]": 0, "filter[sector][id]": 0, "filter[sector][text]": ALL,
        "filter[capitalId]": 0, "filter[capital][id]": 0, "filter[capital][text]": ALL,
        "industryCode": 0, "level": 1, "catID": 0, "capitalID": 0, "languageID": 1}
# Range filters: server 302s to /Error if absent. Values = page's "no filter" defaults.
for k, hi in [("totalVal", 10000), ("totalVol", 500), ("totalValMatching", 10000), ("totalVolMatching", 500),
              ("totalValPut", 10000), ("totalVolPut", 500), ("foreignBuyVal", 10000), ("foreignBuyVol", 500),
              ("foreignSellVal", 10000), ("foreignSellVol", 500), ("closePrice", 2000000),
              ("basicPrice", 2000000), ("floorPrice", 2000000), ("ceilingPrice", 2000000)]:
    FORM[f"filter[{k}][]"] = [0, hi]
FORM["filter[perChange][]"] = [-40, 40]


def session():
    s = requests.Session(); s.headers["User-Agent"] = "Mozilla/5.0"
    html = s.get(f"{BASE}/ban-do-thi-truong", timeout=30).text
    tok = re.search(r'name="?__RequestVerificationToken"?[^>]*value="?([\w-]+)', html).group(1)
    return s, tok


def fetch(s, tok):
    r = s.post(f"{BASE}/data/GetStockByGICS", data={**FORM, "__RequestVerificationToken": tok},
               headers={"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}/ban-do-thi-truong"},
               timeout=30, allow_redirects=False)
    r.raise_for_status()
    return json.loads(r.content.decode("utf-8-sig"))["data"]  # body has a UTF-8 BOM


if __name__ == "__main__":
    iv = int(sys.argv[1]) if len(sys.argv) > 1 else 15
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    s, tok = session(); prev = {}
    for i in range(n):
        rows = fetch(s, tok); cur = {r["_sc_"]: r for r in rows}
        assert len(cur) == len(rows), "duplicate _sc_"
        ch = [k for k in cur if k in prev and (cur[k]["_cp_"], cur[k]["_tvol_"]) != (prev[k]["_cp_"], prev[k]["_tvol_"])]
        print(time.strftime("%H:%M:%S"), f"{len(rows)} stocks, {len(ch)} changed since last poll", flush=True)
        prev = cur
        if i < n - 1:
            time.sleep(iv)
