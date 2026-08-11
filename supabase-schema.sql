<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>窮鬼地圖・200有找</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@700;900&family=Noto+Sans+TC:wght@400;500;700&family=Zhi+Mang+Xing&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<style>
  :root{
    --ink:#22201B;
    --rice:#F6EFDD;
    --rice-dim:#ECE1C6;
    --lantern:#C8342D;
    --lantern-dark:#9E2823;
    --turmeric:#E7A93E;
    --jade:#3F7A5E;
    --charcoal:#4A443B;
    --shadow: 0 6px 18px rgba(34,32,27,0.18);
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{
    background:var(--rice-dim);
    color:var(--ink);
    font-family:'Noto Sans TC', sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3{font-family:'Noto Serif TC', serif; margin:0;}
  button{font-family:inherit; cursor:pointer;}
  input,select{font-family:inherit;}
  :focus-visible{outline:3px solid var(--turmeric); outline-offset:2px;}

  /* ---------- Header ---------- */
  .app-header{
    position:sticky; top:0; z-index:40;
    background:var(--ink);
    color:var(--rice);
    padding:14px 16px 12px;
  }
  .brand-row{display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;}
  .brand-title{font-size:22px; font-weight:900; letter-spacing:0.5px;}
  .brand-badge{
    font-family:'Zhi Mang Xing', cursive;
    font-size:19px;
    color:var(--turmeric);
    border:2px solid var(--turmeric);
    border-radius:4px;
    padding:0px 8px 2px;
    transform:rotate(-4deg);
    display:inline-block;
  }
  .brand-sub{font-size:12.5px; color:#CFC7B0; margin-top:2px;}
  .search-row{display:flex; gap:8px; margin-top:12px;}
  .search-input{
    flex:1; padding:10px 12px; border-radius:10px; border:none;
    background:var(--rice); color:var(--ink); font-size:14.5px;
  }
  .search-input::placeholder{color:#8b8371;}
  .locate-icon-btn{
    background:var(--turmeric); border:none; border-radius:10px;
    width:42px; height:42px; font-size:18px; color:var(--ink); flex-shrink:0;
  }

  /* ---------- Filter chips ---------- */
  .filter-bar{
    position:sticky; top:88px; z-index:35;
    background:var(--rice-dim);
    padding:10px 16px 8px;
    border-bottom:1px dashed #cfc4a0;
  }
  .chip-row{display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none;}
  .chip-row::-webkit-scrollbar{display:none;}
  .chip{
    flex-shrink:0; padding:7px 13px; border-radius:20px; border:1.5px solid var(--charcoal);
    background:var(--rice); font-size:13.5px; font-weight:500; color:var(--charcoal);
    white-space:nowrap;
  }
  .chip.active{background:var(--lantern); border-color:var(--lantern); color:var(--rice);}
  .sort-row{display:flex; align-items:center; gap:8px; margin-top:8px; font-size:13px;}
  .sort-row select{
    padding:6px 8px; border-radius:8px; border:1.5px solid var(--charcoal); background:var(--rice);
  }
  .price-note{margin-left:auto; font-family:'JetBrains Mono', monospace; font-size:12px; color:var(--lantern-dark); font-weight:700;}

  /* ---------- Map ---------- */
  #map{ height:44vh; min-height:280px; width:100%; background:#e5e1d3; position:relative; z-index:1; }
  .leaflet-popup-content-wrapper{ border-radius:10px; font-family:'Noto Sans TC', sans-serif; }
  .price-pill{
    display:flex; align-items:center; justify-content:center;
    height:26px; padding:0 10px; border-radius:13px;
    background:#fff; font-family:'JetBrains Mono', monospace; font-weight:700; font-size:12.5px;
    box-shadow:var(--shadow); border:2.5px solid;
    white-space:nowrap;
  }
  .my-location-dot{
    width:18px; height:18px; border-radius:50%;
    background:#4285F4; border:3px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,0.25), 0 2px 5px rgba(0,0,0,0.3);
  }
  .cluster-badge{
    display:flex; align-items:center; justify-content:center;
    width:100%; height:100%; border-radius:50%;
    background:var(--ink); color:var(--rice); font-family:'JetBrains Mono', monospace; font-weight:700;
    box-shadow:var(--shadow); border:2.5px solid var(--rice);
  }

  /* ---------- List ---------- */
  .list-wrap{ padding:16px; max-width:640px; margin:0 auto; }
  .list-heading{
    display:flex; align-items:baseline; justify-content:space-between; margin-bottom:12px;
  }
  .list-heading h2{font-size:17px;}
  .list-count{font-family:'JetBrains Mono', monospace; font-size:13px; color:var(--charcoal);}

  .ticket-card{
    background:var(--rice); border-radius:12px 12px 0 0;
    box-shadow:var(--shadow); margin-bottom:22px;
    padding:14px 16px 20px;
    position:relative;
    clip-path: polygon(0% 0%,100% 0%,100% 90%,95% 100%,90% 90%,85% 100%,80% 90%,75% 100%,70% 90%,65% 100%,60% 90%,55% 100%,50% 90%,45% 100%,40% 90%,35% 100%,30% 90%,25% 100%,20% 90%,15% 100%,10% 90%,5% 100%,0% 90%);
    animation: rise .35s ease both;
  }
  @keyframes rise{ from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }
  .ticket-head{display:flex; align-items:flex-start; gap:8px;}
  .cat-emoji{font-size:20px; line-height:1;}
  .ticket-name-wrap{flex:1; min-width:0;}
  .ticket-dish{font-size:16.5px; font-weight:700; line-height:1.3;}
  .ticket-store{font-size:12.5px; color:var(--charcoal); margin-top:2px;}
  .tier-tag{
    font-size:11px; font-weight:700; padding:3px 8px; border-radius:5px; color:#fff; flex-shrink:0;
    white-space:nowrap;
  }
  .verified-badge{
    font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:5px;
    background:var(--jade); color:#fff; white-space:nowrap; margin-left:4px;
  }
  .ticket-comment{font-size:13px; color:var(--charcoal); margin:6px 0 8px; line-height:1.5;}
  .ticket-meta{display:flex; align-items:center; gap:10px; font-size:13px;}
  .stars{color:var(--turmeric); letter-spacing:1px;}
  .like-btn{
    margin-left:auto; border:1.5px solid var(--jade); background:transparent; color:var(--jade);
    border-radius:16px; padding:4px 10px; font-size:12.5px; font-weight:700;
  }
  .like-btn.liked{background:var(--jade); color:#fff;}
  .photo-thumb{
    margin-top:10px; border-radius:8px; max-width:100%; max-height:160px; display:block;
    border:1.5px solid #d8cca8;
  }
  .perf-line{
    border-top:2px dashed #cbbf9f; margin:12px 0 10px;
  }
  .ticket-bottom{display:flex; align-items:center; gap:10px;}
  .price-label{font-size:11.5px; color:#8b8371;}
  .price-value{font-family:'JetBrains Mono', monospace; font-weight:700; font-size:21px; color:var(--lantern-dark);}
  .ticket-buttons{ margin-left:auto; display:flex; align-items:center; gap:8px; }
  .locate-btn{
    background:var(--ink); color:var(--rice); border:none; border-radius:8px;
    padding:7px 11px; font-size:12.5px; font-weight:500;
  }
  .delete-btn{
    background:transparent; color:var(--lantern-dark); border:1.5px solid var(--lantern-dark);
    border-radius:8px; padding:7px 11px; font-size:12.5px; font-weight:500;
  }
  .delete-btn:active{ background:var(--lantern-dark); color:#fff; }
  .nickname-tag{font-size:14px; color:#a89d80; margin-top:8px; font-family:'Zhi Mang Xing', cursive;}

  .empty-state{
    text-align:center; padding:40px 20px; color:var(--charcoal);
  }
  .empty-state .stamp{font-size:40px; display:block; margin-bottom:10px;}

  /* ---------- FAB ---------- */
  .fab{
    position:fixed; right:18px; bottom:22px; z-index:50;
    width:58px; height:58px; border-radius:50%; border:none;
    background:var(--lantern); color:#fff; font-size:28px; box-shadow:var(--shadow);
    display:flex; align-items:center; justify-content:center;
  }
  .fab:active{transform:scale(0.94);}

  /* ---------- Modal ---------- */
  .overlay{
    position:fixed; inset:0; background:rgba(34,32,27,0.55); z-index:60;
    display:flex; align-items:flex-end; justify-content:center;
  }
  .hidden{display:none !important;}
  .sheet{
    background:var(--rice); width:100%; max-width:520px; border-radius:18px 18px 0 0;
    max-height:88vh; overflow-y:auto; padding:20px 20px 26px;
    animation: sheetUp .28s ease both;
  }
  @keyframes sheetUp{ from{transform:translateY(24px); opacity:0;} to{transform:translateY(0); opacity:1;} }
  .sheet-title{font-size:18px; font-weight:900; margin-bottom:2px;}
  .sheet-sub{font-size:12.5px; color:var(--charcoal); margin-bottom:16px;}
  .field{margin-bottom:14px;}
  .field label{display:block; font-size:13px; font-weight:700; margin-bottom:5px;}
  .field input, .field textarea, .field select{
    width:100%; padding:10px 11px; border-radius:9px; border:1.5px solid #d8cca8; background:#fff;
    font-size:14px;
  }
  .field textarea{resize:none; height:56px;}
  .hint{font-size:11.5px; color:#a89d80; margin-top:4px;}
  .hint.err{color:var(--lantern); font-weight:700;}
  .star-picker{display:flex; gap:6px; font-size:26px;}
  .star-picker span{cursor:pointer; color:#d8cca8;}
  .star-picker span.on{color:var(--turmeric);}
  #pickMap{ height:180px; border-radius:10px; margin-top:6px; border:1.5px solid #d8cca8; background:#e5e1d3; position:relative; z-index:1; }
  .address-results{
    margin-top:6px; border:1.5px solid #d8cca8; border-radius:9px; overflow:hidden; background:#fff;
    max-height:220px; overflow-y:auto;
  }
  .addr-result-item{ padding:10px 12px; font-size:13px; border-bottom:1px solid #ece1c6; cursor:pointer; }
  .addr-result-item:last-child{ border-bottom:none; }
  .addr-result-item:hover, .addr-result-item:active{ background:var(--rice-dim); }
  .addr-result-empty{ padding:10px 12px; font-size:13px; color:var(--charcoal); }
  .sheet-actions{display:flex; gap:10px; margin-top:18px;}
  .btn-secondary, .btn-primary{
    flex:1; padding:12px; border-radius:10px; border:none; font-size:14.5px; font-weight:700;
  }
  .btn-secondary{background:var(--rice-dim); color:var(--charcoal); border:1.5px solid #d8cca8;}
  .btn-primary{background:var(--ink); color:var(--rice);}
  .btn-primary:disabled{opacity:0.6;}
  .btn-primary:active{transform:scale(0.98);}

  .toast{
    position:fixed; left:50%; bottom:96px; transform:translateX(-50%);
    background:var(--jade); color:#fff; padding:10px 18px; border-radius:20px; font-size:13.5px;
    font-weight:700; z-index:80; box-shadow:var(--shadow);
    animation: stampIn .35s ease both;
    max-width:88vw; text-align:center;
  }
  .toast.error{ background:var(--lantern); }
  @keyframes stampIn{ 0%{opacity:0; transform:translateX(-50%) scale(1.5) rotate(-8deg);} 60%{opacity:1; transform:translateX(-50%) scale(0.95) rotate(2deg);} 100%{opacity:1; transform:translateX(-50%) scale(1) rotate(0);} }

  .loading{ text-align:center; padding:40px; color:var(--charcoal); font-size:13.5px; }

  @media (prefers-reduced-motion: reduce){
    *{animation:none !important; transition:none !important;}
  }
</style>
</head>
<body>

<header class="app-header">
  <div class="brand-row">
    <h1 class="brand-title">窮鬼地圖</h1>
    <span class="brand-badge">200有找</span>
  </div>
  <div class="brand-sub">全民揪團回報的高CP值品項・一餐不超過 200 元</div>
  <div class="search-row">
    <input id="searchInput" class="search-input" type="text" placeholder="搜尋店名、品項關鍵字…" />
    <button id="locateBtn" class="locate-icon-btn" aria-label="定位我的位置">📍</button>
  </div>
</header>

<div class="filter-bar">
  <div class="chip-row" id="chipRow"></div>
  <div class="sort-row">
    <label for="sortSelect" style="color:var(--charcoal);">排序</label>
    <select id="sortSelect">
      <option value="rating">評分最高</option>
      <option value="priceAsc">價格最低</option>
      <option value="likes">最多人推</option>
      <option value="newest">最新回報</option>
    </select>
    <span class="price-note">全站上限 $200</span>
  </div>
</div>

<div id="map"></div>

<div class="list-wrap">
  <div class="list-heading">
    <h2>品項清單</h2>
    <span class="list-count" id="listCount">0 筆</span>
  </div>
  <div id="listContainer"><div class="loading">正在讀取大家回報的口袋名單…</div></div>
</div>

<button class="fab" id="openAddBtn" aria-label="新增品項">＋</button>

<div class="overlay hidden" id="overlay">
  <div class="sheet">
    <div class="sheet-title">回報一道 200 有找的品項</div>
    <div class="sheet-sub">請填「哪間店的哪道菜／哪個套餐」，大家會看到你回報的資料，請盡量填寫真實資訊唷。</div>

    <div class="field">
      <label for="fStore">店名</label>
      <input id="fStore" type="text" placeholder="例如：巷口無名滷肉飯" maxlength="30" />
    </div>

    <div class="field">
      <label for="fDish">招牌品項名稱</label>
      <input id="fDish" type="text" placeholder="例如：乾麵套餐" maxlength="30" />
      <div class="hint">價格是指「這個品項」，不是整間店的均價</div>
    </div>

    <div class="field">
      <label for="fCategory">分類</label>
      <select id="fCategory">
        <option value="早餐">🥯 早餐</option>
        <option value="正餐">🍚 正餐</option>
        <option value="小吃">🍢 小吃</option>
        <option value="飲料">🥤 飲料</option>
        <option value="宵夜">🌙 宵夜</option>
      </select>
    </div>

    <div class="field">
      <label for="fPrice">這個品項的價格（新台幣）</label>
      <input id="fPrice" type="number" min="1" max="200" placeholder="150" />
      <div class="hint" id="priceHint">超過 200 就不是「俗擱大碗」囉，上限 200 元</div>
    </div>

    <div class="field">
      <label>評分</label>
      <div class="star-picker" id="starPicker">
        <span data-v="1">★</span><span data-v="2">★</span><span data-v="3">★</span><span data-v="4">★</span><span data-v="5">★</span>
      </div>
    </div>

    <div class="field">
      <label for="fComment">一句話推薦</label>
      <textarea id="fComment" maxlength="60" placeholder="例如：便宜大碗，湯頭很夠味！"></textarea>
    </div>

    <div class="field">
      <label for="fPhoto">上傳菜單／收據照片（選填）</label>
      <input id="fPhoto" type="file" accept="image/*" />
      <div class="hint">作為佐證，未來也會用來審核店家認證</div>
    </div>

    <div class="field">
      <label for="fAddressSearch">搜尋店名／地址自動定位（選填）</label>
      <div style="display:flex; gap:8px;">
        <input id="fAddressSearch" type="text" placeholder="輸入地址、路名或店名關鍵字" />
        <button type="button" id="searchAddressBtn" class="btn-secondary" style="flex:0 0 auto; padding:0 16px;">搜尋</button>
      </div>
      <div id="addressResults" class="hidden address-results"></div>
    </div>

    <div class="field">
      <label>店家位置（點地圖放置圖釘）</label>
      <div id="pickMap"></div>
      <div class="hint">搜尋後點選正確地點，圖釘會自動移過去；也可以直接在地圖上點擊微調位置</div>
    </div>

    <div class="field">
      <label for="fNick">你的暱稱（選填）</label>
      <input id="fNick" type="text" placeholder="省錢戰士" maxlength="12" />
    </div>

    <div class="sheet-actions">
      <button class="btn-secondary" id="cancelAddBtn">取消</button>
      <button class="btn-primary" id="submitAddBtn">蓋章送出</button>
    </div>
  </div>
</div>

<script src="config.js"></script>
<script src="app.js"></script>
</body>
</html>
