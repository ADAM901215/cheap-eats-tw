(function(){
  const CATS = ['全部','早餐','正餐','小吃','飲料','宵夜'];
  const CAT_EMOJI = {'早餐':'🥯','正餐':'🍚','小吃':'🍢','飲料':'🥤','宵夜':'🌙'};
  const NICKS = ['省錢戰士','小資魂','摳門大師','荷包守護者','CP值獵人','窮遊冠軍'];
  const PHOTO_BUCKET = 'photos';
  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  // ---------- Supabase client ----------
  if(!window.supabase || !window.SUPABASE_URL || window.SUPABASE_URL.indexOf('請貼上') === 0){
    document.addEventListener('DOMContentLoaded', function(){
      document.getElementById('listContainer').innerHTML =
        '<div class="empty-state"><span class="stamp">⚠️</span>還沒有設定 Supabase 連線資訊<br/>請打開 config.js，貼上你的 Supabase 網址與 anon key</div>';
    });
    return;
  }
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  let restaurants = [];
  let state = { category:'全部', sort:'rating', search:'' };
  let map, clusterGroup, pickMap, pickMarker, myLocationMarker, myAccuracyCircle;
  let locationWatchId = null;
  let lastKnownLatLng = null;
  let markerById = {}; // id -> leaflet marker（方便定位時開 popup）
  let likedIds = new Set(); // 階段一：僅前端本次瀏覽期間記憶，尚未寫入資料庫
  let currentUserId = null;

  function tierInfo(price){
    if(price<=80) return {color:'#5CA184', label:'超佛心'};
    if(price<=150) return {color:'#E5AC55', label:'俗擱大碗'};
    return {color:'#E8895F', label:'划算頂規'};
  }

  function starString(n){
    return '★★★★★☆☆☆☆☆'.slice(5-n,10-n);
  }

  // ---------- 匿名登入 ----------
  async function ensureAuth(){
    const { data: sessionData } = await sb.auth.getSession();
    if(sessionData && sessionData.session){
      currentUserId = sessionData.session.user.id;
      return;
    }
    const { data, error } = await sb.auth.signInAnonymously();
    if(error){
      console.error('匿名登入失敗', error);
      showToast('連線失敗，請重新整理頁面再試一次', true);
      return;
    }
    currentUserId = data.user.id;
  }

  // ---------- 讀取資料 ----------
  // 顯示規則：所有「approved」的品項大家都看得到；「pending」（審核中）的品項只有回報者自己看得到，
  // 並會標示「審核中」，其他人暫時看不到，等審核通過才會公開。
  async function loadData(){
    let query = sb.from('restaurants').select('*').order('created_at', { ascending:false });
    if(currentUserId){
      query = query.or(`status.eq.approved,and(status.eq.pending,reporter_id.eq.${currentUserId})`);
    }else{
      query = query.eq('status', 'approved');
    }
    const { data, error } = await query;
    if(error){
      console.error('讀取資料失敗', error);
      document.getElementById('listContainer').innerHTML =
        '<div class="empty-state"><span class="stamp">⚠️</span>讀取資料失敗，請稍後重新整理頁面</div>';
      return;
    }
    restaurants = (data||[]).map(r=>({
      id: r.id,
      storeName: r.store_name,
      dishName: r.dish_name,
      category: r.category,
      price: r.price,
      rating: r.rating,
      comment: r.comment,
      lat: r.lat,
      lng: r.lng,
      nickname: r.nickname,
      reporterId: r.reporter_id,
      photoUrl: r.photo_url,
      likes: r.likes || 0,
      confirmCount: r.confirm_count || 0,
      isVerified: r.is_verified,
      status: r.status,
      tags: r.tags || [],
      businessHours: r.business_hours,
      note: r.note,
      createdAt: new Date(r.created_at).getTime()
    }));
    renderAll();
  }

  function initMap(){
    map = L.map('map', { zoomControl:true, tap:true, preferCanvas:true }).setView([25.0478,121.5319], 13);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom:20 }).addTo(map);
    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: function(cluster){
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div class="cluster-badge" style="width:${count<10?38:count<100?44:50}px; height:${count<10?38:count<100?44:50}px; font-size:${count<10?13:12}px;">${count}</div>`,
          className: '',
          iconSize: null
        });
      }
    });
    map.addLayer(clusterGroup);
    startLocationWatch();
  }

  // ---------- 使用者目前位置的藍點（持續追蹤，會隨你移動即時更新）----------
  function updateMyLocationMarker(pos){
    const latlng = [pos.coords.latitude, pos.coords.longitude];
    lastKnownLatLng = latlng;
    const icon = L.divIcon({ className:'', html:'<div class="my-location-dot"></div>', iconSize:[18,18], iconAnchor:[9,9] });
    if(!myLocationMarker){
      myLocationMarker = L.marker(latlng, { icon, zIndexOffset:1000, title:'你的位置' }).addTo(map);
    }else{
      myLocationMarker.setLatLng(latlng);
    }
    const acc = pos.coords.accuracy;
    if(acc && acc < 500){
      if(!myAccuracyCircle){
        myAccuracyCircle = L.circle(latlng, {
          radius:acc, interactive:false,
          color:'#4285F4', weight:1, opacity:0.35, fillColor:'#4285F4', fillOpacity:0.12
        }).addTo(map);
      }else{
        myAccuracyCircle.setLatLng(latlng);
        myAccuracyCircle.setRadius(acc);
      }
    }
  }

  function startLocationWatch(){
    if(!navigator.geolocation || locationWatchId!==null) return;
    locationWatchId = navigator.geolocation.watchPosition(
      pos=> updateMyLocationMarker(pos),
      err=> console.warn('位置追蹤失敗', err),
      { enableHighAccuracy:true, maximumAge:5000, timeout:15000 }
    );
  }

  function tryShowMyLocation(silent){
    if(!navigator.geolocation) return;
    startLocationWatch();
    if(lastKnownLatLng) return;
    navigator.geolocation.getCurrentPosition(
      pos=> updateMyLocationMarker(pos),
      ()=>{ if(!silent) showToast('無法取得你的位置，請確認已允許定位權限'); },
      { enableHighAccuracy:true, timeout:8000 }
    );
  }

  // 藥丸形價格標籤
  function makePillIcon(r){
    const t = tierInfo(r.price);
    return L.divIcon({
      className:'',
      html:`<div class="price-pill" style="border-color:${t.color}; color:${t.color};">$${r.price}</div>`,
      iconSize:null,
      iconAnchor:[26,13]
    });
  }

  function filteredSorted(){
    let list = restaurants.filter(r=>{
      if(state.category!=='全部' && r.category!==state.category) return false;
      if(state.search){
        const kw = state.search;
        const hit = (r.storeName&&r.storeName.includes(kw)) || (r.dishName&&r.dishName.includes(kw));
        if(!hit) return false;
      }
      return r.price<=200;
    });
    if(state.sort==='rating') list.sort((a,b)=>b.rating-a.rating);
    else if(state.sort==='priceAsc') list.sort((a,b)=>a.price-b.price);
    else if(state.sort==='likes') list.sort((a,b)=>b.likes-a.likes);
    else if(state.sort==='newest') list.sort((a,b)=>b.createdAt-a.createdAt);
    return list;
  }

  function renderChips(){
    const row = document.getElementById('chipRow');
    row.innerHTML = '';
    CATS.forEach(c=>{
      const chip = document.createElement('button');
      chip.className = 'chip' + (state.category===c ? ' active':'');
      chip.textContent = c==='全部' ? '全部' : (CAT_EMOJI[c]+' '+c);
      chip.onclick = ()=>{ state.category=c; renderAll(); };
      row.appendChild(chip);
    });
  }

  function renderMarkers(list){
    clusterGroup.clearLayers();
    markerById = {};
    const newMarkers = [];
    list.forEach(r=>{
      const t = tierInfo(r.price);
      const m = L.marker([r.lat,r.lng], {icon: makePillIcon(r)});
      m.bindPopup(
        `<div style="min-width:170px;">
          <strong>${escapeHtml(r.dishName)}</strong>　<span style="font-family:'JetBrains Mono',monospace; font-weight:700;">$${r.price}</span><br/>
          <span style="font-size:12px; color:#6B7280;">${escapeHtml(r.storeName)}</span>${r.status==='pending'? ' <span style="font-size:11px; color:#E5AC55; font-weight:700;">⏳審核中</span>':''}<br/>
          <span style="color:${t.color}; font-weight:700; font-size:12px;">${t.label}</span>　${starString(r.rating)}<br/>
          <span style="font-size:12.5px;">${escapeHtml(r.comment||'')}</span><br/>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}" target="_blank" rel="noopener" style="font-size:12.5px;">🧭 導航前往</a>
        </div>`
      );
      markerById[r.id] = m;
      newMarkers.push(m);
    });
    clusterGroup.addLayers(newMarkers);
  }

  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function renderList(list){
    const container = document.getElementById('listContainer');
    document.getElementById('listCount').textContent = list.length + ' 筆';
    if(list.length===0){
      container.innerHTML = `<div class="empty-state"><span class="stamp">🈳</span>這個篩選條件下還沒有品項<br/>快按右下角「＋」當第一個回報的人吧！</div>`;
      return;
    }
    container.innerHTML = list.map(r=>{
      const t = tierInfo(r.price);
      const liked = likedIds.has(r.id);
      return `
      <div class="ticket-card" data-id="${r.id}">
        <div class="ticket-head">
          <span class="cat-emoji">${CAT_EMOJI[r.category]||'🍽️'}</span>
          <div class="ticket-name-wrap">
            <div class="ticket-dish">${escapeHtml(r.dishName)}</div>
            <div class="ticket-store">${escapeHtml(r.storeName)}${r.isVerified? '<span class="verified-badge">✓ 店家認證</span>':''}${r.status==='pending'? '<span class="pending-badge">⏳ 審核中</span>':''}</div>
          </div>
          <span class="tier-tag" style="background:${t.color}">${t.label}</span>
        </div>
        <p class="ticket-comment">「${escapeHtml(r.comment||'')}」</p>
        ${r.tags && r.tags.length ? `<div class="tag-pick-list" style="margin-bottom:8px;">${r.tags.map(t=>`<span class="tag-chip active" style="pointer-events:none; padding:4px 10px; font-size:11.5px;">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="ticket-meta">
          <span class="stars">${starString(r.rating)}</span>
          <button class="like-btn ${liked?'liked':''}" data-like="${r.id}">👍 ${r.likes||0}</button>
        </div>
        ${r.photoUrl ? `<img class="photo-thumb" src="${escapeHtml(r.photoUrl)}" alt="菜單或收據照片" loading="lazy" />` : ''}
        <div class="nickname-tag">by ${escapeHtml(r.nickname||'匿名店探')}</div>
        <div class="perf-line"></div>
        <div class="ticket-bottom">
          <div>
            <div class="price-label">品項價格</div>
            <div class="price-value">$${r.price}</div>
          </div>
          <div class="ticket-buttons">
            ${r.reporterId===currentUserId ? `<button class="delete-btn" data-delete="${r.id}">🗑️ 刪除</button>` : ''}
            <button class="locate-btn" data-locate="${r.id}">📍 在地圖上看</button>
          </div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('[data-like]').forEach(btn=>{
      btn.onclick = ()=>toggleLike(btn.getAttribute('data-like'));
    });
    container.querySelectorAll('[data-locate]').forEach(btn=>{
      btn.onclick = ()=>locateOnMap(btn.getAttribute('data-locate'));
    });
    container.querySelectorAll('[data-delete]').forEach(btn=>{
      btn.onclick = ()=>deleteRestaurant(btn.getAttribute('data-delete'));
    });
  }

  async function deleteRestaurant(id){
    const r = restaurants.find(x=>x.id===id);
    if(!r) return;
    const ok = window.confirm(`確定要刪除「${r.dishName}」這筆回報嗎？刪除後無法復原。`);
    if(!ok) return;
    const { error } = await sb.from('restaurants').delete().eq('id', id);
    if(error){
      console.error('刪除失敗', error);
      showToast('刪除失敗：' + (error.message || '請稍後再試'), true);
      return;
    }
    showToast('已刪除這筆回報');
    await loadData();
  }

  // 階段一：讚功能先做前端視覺互動，尚未寫入 likes 資料表（見需求書階段二）
  function toggleLike(id){
    const r = restaurants.find(x=>x.id===id);
    if(!r) return;
    if(likedIds.has(id)){
      likedIds.delete(id); r.likes = Math.max(0,(r.likes||0)-1);
    }else{
      likedIds.add(id); r.likes = (r.likes||0)+1;
    }
    renderAll();
  }

  function locateOnMap(id){
    const r = restaurants.find(x=>x.id===id);
    if(!r) return;
    const sheet = document.getElementById('listSheet');
    if(sheet) sheet.classList.add('collapsed');
    map.flyTo([r.lat,r.lng], 16, {duration:0.6});
    setTimeout(()=>{
      const m = markerById[id];
      if(m){
        if(clusterGroup.hasLayer(m)) clusterGroup.zoomToShowLayer(m, ()=> m.openPopup());
        else m.openPopup();
      }
    }, 650);
  }

  // ---------- 餐廳清單「底部抽屜」開合（像 Uber Eats 一樣，地圖上滑出清單）----------
  const listSheet = document.getElementById('listSheet');
  const listSheetHandle = document.getElementById('listSheetHandle');
  if(listSheetHandle){
    listSheetHandle.addEventListener('click', function(){
      listSheet.classList.toggle('collapsed');
    });
  }

  function renderAll(){
    renderChips();
    const list = filteredSorted();
    renderMarkers(list);
    renderList(list);
  }

  function showToast(msg, isError){
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 2400);
  }

  // ---------- Add restaurant modal（一步一步引導的回報流程）----------
  const TAG_OPTIONS = ['現金','學生優惠','外帶方便','座位少','可停車'];
  const TOTAL_STEPS = 9;
  let currentStep = 1;
  let chosenRating = 0;
  let chosenPhotoFiles = [];
  let chosenCategory = null;
  let chosenTags = [];
  let addressSelected = false;
  let selectedAddressText = '';
  const overlay = document.getElementById('overlay');

  function openModal(){
    overlay.classList.remove('hidden');
    document.getElementById('fStore').value='';
    document.getElementById('fDish').value='';
    document.getElementById('fPrice').value='';
    document.getElementById('fComment').value='';
    document.getElementById('fNick').value = NICKS[Math.floor(Math.random()*NICKS.length)] + Math.floor(Math.random()*9000+1000);
    document.getElementById('fPhoto').value='';
    document.getElementById('fHours').value='';
    document.getElementById('fNote').value='';
    chosenPhotoFiles = [];
    document.getElementById('photoPreviewRow').innerHTML='';
    document.getElementById('fAddressSearch').value='';
    document.getElementById('addressResults').classList.add('hidden');
    document.getElementById('addressResults').innerHTML='';
    document.getElementById('selectedStoreWrap').style.display='none';
    addressSelected = false;
    selectedAddressText = '';
    document.getElementById('priceHint').textContent = '超過 200 就不是「俗擱大碗」囉，上限 200 元';
    document.getElementById('priceHint').classList.remove('err');
    chosenRating = 0;
    chosenCategory = null;
    chosenTags = [];
    updateStarPicker();
    showStep(1);
  }

  function closeModal(){ overlay.classList.add('hidden'); }

  // ---------- Wizard 導覽 ----------
  function stepErrorMessage(step){
    switch(step){
      case 1: return '請填寫暱稱';
      case 2: return '請先搜尋並選擇正確的店家';
      case 3: return '請填寫品項名稱與 1～200 之間的價格';
      case 4: return '請選一個分類';
      case 6: return '請給個評分';
      case 7: return '請至少上傳 1 張照片';
      default: return '請完成這一步再繼續';
    }
  }

  function validateStep(step){
    switch(step){
      case 1: return document.getElementById('fNick').value.trim().length>0;
      case 2: return addressSelected && document.getElementById('fStore').value.trim().length>0;
      case 3: {
        const dish = document.getElementById('fDish').value.trim();
        const price = parseInt(document.getElementById('fPrice').value);
        return dish.length>0 && price>=1 && price<=200;
      }
      case 4: return !!chosenCategory;
      case 5: return true;
      case 6: return chosenRating>0;
      case 7: return chosenPhotoFiles.length>=1;
      case 8: return true;
      case 9: return true;
      default: return true;
    }
  }

  function showStep(n){
    currentStep = n;
    document.querySelectorAll('.wizard-step').forEach(el=>{
      el.classList.toggle('hidden', parseInt(el.getAttribute('data-step'))!==n);
    });
    document.getElementById('wizardStepCount').textContent = n + ' / ' + TOTAL_STEPS;
    document.getElementById('wizardProgressFill').style.width = Math.round(n/TOTAL_STEPS*100) + '%';
    document.getElementById('wizardPrevBtn').style.visibility = n===1 ? 'hidden' : 'visible';
    document.getElementById('wizardNextBtn').textContent = n===TOTAL_STEPS ? '送出回報' : '下一步';
    if(n===4) renderCategoryPickList();
    if(n===5) renderTagPickList();
    if(n===9) renderWizardSummary();
    if(n===2 && pickMap) setTimeout(()=> pickMap.invalidateSize(), 50);
  }

  document.getElementById('wizardNextBtn').addEventListener('click', async function(){
    if(!validateStep(currentStep)){
      showToast(stepErrorMessage(currentStep));
      return;
    }
    if(currentStep < TOTAL_STEPS){
      showStep(currentStep+1);
    }else{
      await submitReport(this);
    }
  });
  document.getElementById('wizardPrevBtn').addEventListener('click', function(){
    if(currentStep>1) showStep(currentStep-1);
  });

  document.getElementById('reRollNickBtn').addEventListener('click', function(){
    document.getElementById('fNick').value = NICKS[Math.floor(Math.random()*NICKS.length)] + Math.floor(Math.random()*9000+1000);
  });

  function renderCategoryPickList(){
    const wrap = document.getElementById('categoryPickList');
    wrap.innerHTML = CATS.filter(c=>c!=='全部').map(c=>`
      <button type="button" class="category-pick-item ${chosenCategory===c?'active':''}" data-cat="${c}">
        <span>${CAT_EMOJI[c]}</span> ${c}
      </button>`).join('');
    wrap.querySelectorAll('[data-cat]').forEach(btn=>{
      btn.onclick = ()=>{ chosenCategory = btn.getAttribute('data-cat'); renderCategoryPickList(); };
    });
  }

  function renderTagPickList(){
    const wrap = document.getElementById('tagPickList');
    wrap.innerHTML = TAG_OPTIONS.map(t=>`
      <button type="button" class="tag-chip ${chosenTags.includes(t)?'active':''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
    `).join('');
    wrap.querySelectorAll('[data-tag]').forEach(btn=>{
      btn.onclick = ()=>{
        const t = btn.getAttribute('data-tag');
        if(chosenTags.includes(t)) chosenTags = chosenTags.filter(x=>x!==t);
        else chosenTags.push(t);
        renderTagPickList();
      };
    });
  }

  function renderWizardSummary(){
    const rows = [
      ['暱稱', document.getElementById('fNick').value.trim()],
      ['店家', document.getElementById('fStore').value.trim()],
      ['地址', selectedAddressText || '（未提供）'],
      ['品項', document.getElementById('fDish').value.trim()],
      ['價格', '$' + (document.getElementById('fPrice').value || '')],
      ['分類', chosenCategory || ''],
      ['特色標籤', chosenTags.length ? chosenTags.join('、') : '（無）'],
      ['評分', starString(chosenRating)],
      ['一句話推薦', document.getElementById('fComment').value.trim() || '（無）'],
      ['照片', chosenPhotoFiles.length + ' 張'],
      ['營業時間', document.getElementById('fHours').value.trim() || '（未提供）'],
      ['備註', document.getElementById('fNote').value.trim() || '（無）']
    ];
    document.getElementById('wizardSummary').innerHTML = rows.map(([label,value])=>`
      <div class="summary-row"><span class="summary-label">${escapeHtml(label)}</span><span class="summary-value">${escapeHtml(String(value))}</span></div>
    `).join('');
  }

  // ---------- 地址／店名搜尋自動定位（使用 OpenStreetMap 的免費 Nominatim 服務）----------
  let addressSearchBusy = false;
  async function searchAddress(){
    const input = document.getElementById('fAddressSearch');
    const resultsBox = document.getElementById('addressResults');
    const q = input.value.trim();
    if(!q){ resultsBox.classList.add('hidden'); resultsBox.innerHTML=''; return; }
    if(addressSearchBusy) return;
    addressSearchBusy = true;
    resultsBox.classList.remove('hidden');
    resultsBox.innerHTML = '<div class="addr-result-empty">搜尋中…</div>';
    try{
      const center = pickMap ? pickMap.getCenter() : map.getCenter();
      const viewbox = [
        (center.lng-0.15).toFixed(5), (center.lat+0.15).toFixed(5),
        (center.lng+0.15).toFixed(5), (center.lat-0.15).toFixed(5)
      ].join(',');
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=tw&viewbox=${viewbox}&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'zh-TW' } });
      const data = await res.json();
      if(!data || data.length===0){
        resultsBox.innerHTML = '<div class="addr-result-empty">找不到符合的地點，換個關鍵字試試看</div>';
        return;
      }
      resultsBox.innerHTML = data.map((r,i)=>`<div class="addr-result-item" data-i="${i}">${escapeHtml(r.display_name)}</div>`).join('');
      resultsBox.querySelectorAll('.addr-result-item').forEach(el=>{
        el.onclick = ()=>{
          const r = data[parseInt(el.getAttribute('data-i'))];
          const lat = parseFloat(r.lat), lon = parseFloat(r.lon);

          if(!pickMap){
            pickMap = L.map('pickMap').setView([lat,lon], 17);
            L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom:20 }).addTo(pickMap);
            pickMarker = L.marker([lat,lon], {draggable:true}).addTo(pickMap);
            pickMap.on('click', e=> pickMarker.setLatLng(e.latlng));
          }else{
            pickMap.setView([lat,lon], 17);
            pickMarker.setLatLng([lat,lon]);
          }

          addressSelected = true;
          selectedAddressText = r.display_name;
          const storeInput = document.getElementById('fStore');
          if(!storeInput.value.trim()){ storeInput.value = q; }
          document.getElementById('selectedStoreCard').innerHTML =
            `<strong>${escapeHtml(q)}</strong><br/>${escapeHtml(r.display_name)}`;
          document.getElementById('selectedStoreWrap').style.display = 'block';
          setTimeout(()=> pickMap.invalidateSize(), 50);

          resultsBox.classList.add('hidden');
          resultsBox.innerHTML='';
        };
      });
    }catch(e){
      console.error('地址搜尋失敗', e);
      resultsBox.innerHTML = '<div class="addr-result-empty">搜尋失敗，請稍後再試</div>';
    }finally{
      addressSearchBusy = false;
    }
  }

  document.getElementById('searchAddressBtn').addEventListener('click', searchAddress);
  document.getElementById('fAddressSearch').addEventListener('keydown', function(e){
    if(e.key==='Enter'){ e.preventDefault(); searchAddress(); }
  });

  function updateStarPicker(){
    document.querySelectorAll('#starPicker span').forEach(s=>{
      s.classList.toggle('on', parseInt(s.getAttribute('data-v'))<=chosenRating);
    });
  }

  document.getElementById('starPicker').addEventListener('click', e=>{
    if(e.target.tagName==='SPAN'){ chosenRating = parseInt(e.target.getAttribute('data-v')); updateStarPicker(); }
  });

  document.getElementById('openAddBtn').onclick = openModal;
  document.getElementById('cancelAddBtn').onclick = closeModal;
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeModal(); });

  document.getElementById('fPhoto').addEventListener('change', function(){
    chosenPhotoFiles = Array.from(this.files || []).slice(0,3);
    const row = document.getElementById('photoPreviewRow');
    row.innerHTML = '';
    chosenPhotoFiles.forEach(f=>{
      const img = document.createElement('img');
      img.className = 'photo-preview-thumb';
      img.src = URL.createObjectURL(f);
      row.appendChild(img);
    });
  });

  document.getElementById('fPrice').addEventListener('input', function(){
    const v = parseInt(this.value);
    const hint = document.getElementById('priceHint');
    if(v>200){ hint.textContent='超過 200 元無法送出，請確認金額'; hint.classList.add('err'); }
    else { hint.textContent='超過 200 就不是「俗擱大碗」囉，上限 200 元'; hint.classList.remove('err'); }
  });

  async function uploadPhotos(){
    const urls = [];
    for(const file of chosenPhotoFiles){
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${currentUserId}/${Date.now()}_${urls.length}.${ext}`;
      const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false
      });
      if(error){
        console.error('照片上傳失敗', error);
        showToast('有一張照片上傳失敗，其他資料仍會送出', true);
        continue;
      }
      const { data } = sb.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      if(data && data.publicUrl) urls.push(data.publicUrl);
    }
    return urls;
  }

  async function submitReport(submitBtn){
    const storeName = document.getElementById('fStore').value.trim();
    const dishName = document.getElementById('fDish').value.trim();
    const price = parseInt(document.getElementById('fPrice').value);
    const comment = document.getElementById('fComment').value.trim();
    const hours = document.getElementById('fHours').value.trim();
    const note = document.getElementById('fNote').value.trim();
    let nickname = document.getElementById('fNick').value.trim();

    if(!storeName || !dishName || !price || price<1 || price>200 || !chosenCategory || chosenRating===0 || chosenPhotoFiles.length===0 || !pickMarker){
      showToast('資料不完整，請確認每一步都已填寫');
      return;
    }
    if(!currentUserId){ showToast('連線尚未就緒，請稍後再試', true); return; }
    if(!nickname) nickname = NICKS[Math.floor(Math.random()*NICKS.length)];

    const pos = pickMarker.getLatLng();

    submitBtn.disabled = true;
    submitBtn.textContent = '送出中…';

    const photoUrls = await uploadPhotos();

    const { data, error } = await sb.from('restaurants').insert({
      store_name: storeName,
      dish_name: dishName,
      category: chosenCategory, price, rating: chosenRating, comment,
      lat: pos.lat, lng: pos.lng,
      nickname,
      reporter_id: currentUserId,
      photo_url: photoUrls[0] || null,
      photo_urls: photoUrls,
      tags: chosenTags,
      business_hours: hours || null,
      note: note || null
    }).select().single();

    submitBtn.disabled = false;
    submitBtn.textContent = '送出回報';

    if(error){
      console.error('送出失敗', error);
      showToast('送出失敗：' + (error.message || '請稍後再試'), true);
      return;
    }

    closeModal();
    await loadData();
    if(data && data.status==='pending'){
      showToast('已送出，系統判斷需要人工審核，通過後才會公開給大家看到 ⏳');
    }else{
      showToast('蓋章成功！感謝你的回報 🎫');
    }
    setTimeout(()=>locateOnMap(data.id), 300);
  }

  // ---------- Filters / search / sort ----------
  let searchDebounceTimer = null;
  document.getElementById('searchInput').addEventListener('input', function(){
    clearTimeout(searchDebounceTimer);
    const val = this.value.trim();
    searchDebounceTimer = setTimeout(()=>{ state.search = val; renderAll(); }, 200);
  });
  document.getElementById('sortSelect').addEventListener('change', function(){
    state.sort = this.value;
    renderAll();
  });
  document.getElementById('locateBtn').addEventListener('click', function(){
    if(!navigator.geolocation){ showToast('這個瀏覽器不支援定位'); return; }
    startLocationWatch();
    if(lastKnownLatLng){
      map.flyTo(lastKnownLatLng, 15, {duration:0.6});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos=>{
        updateMyLocationMarker(pos);
        map.flyTo(lastKnownLatLng, 15, {duration:0.6});
      },
      ()=>{ showToast('無法取得你的位置，請確認已允許定位權限'); }
    );
  });

  // ---------- 分頁切換（地圖／討論區／設定）----------
  let currentPage = 'mapPage';
  document.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', function(){
      const page = this.getAttribute('data-page');
      switchPage(page);
    });
  });

  function switchPage(page){
    currentPage = page;
    document.querySelectorAll('.page').forEach(p=> p.classList.toggle('hidden', p.id!==page));
    document.querySelectorAll('.nav-item').forEach(btn=> btn.classList.toggle('active', btn.getAttribute('data-page')===page));
    const fab = document.getElementById('openAddBtn');
    if(page==='mapPage'){
      fab.classList.remove('hidden');
      fab.onclick = openModal;
      fab.setAttribute('aria-label','新增品項');
      fab.textContent = '＋';
    }else if(page==='boardPage'){
      fab.classList.remove('hidden');
      fab.onclick = openPostModal;
      fab.setAttribute('aria-label','發表新文章');
      fab.textContent = '✎';
      loadPosts();
    }else if(page==='dashboardPage'){
      fab.classList.add('hidden');
      loadPoints();
    }else{
      fab.classList.add('hidden');
      updateLoginUI();
    }
    if(page==='mapPage' && map) setTimeout(()=> map.invalidateSize(), 50);
  }

  // ---------- 登入（Email 驗證連結，會把匿名身分升級成正式帳號，資料不會不見）----------
  const loginOverlay = document.getElementById('loginOverlay');
  document.getElementById('loginActionBtn').addEventListener('click', async function(){
    const { data } = await sb.auth.getUser();
    const isLoggedIn = data && data.user && !data.user.is_anonymous;
    if(isLoggedIn){
      const ok = window.confirm('確定要登出嗎？登出後會變回匿名瀏覽身分。');
      if(!ok) return;
      await sb.auth.signOut();
      await ensureAuth();
      updateLoginUI();
      showToast('已登出');
    }else{
      loginOverlay.classList.remove('hidden');
    }
  });
  document.getElementById('cancelLoginBtn').onclick = ()=> loginOverlay.classList.add('hidden');
  loginOverlay.addEventListener('click', e=>{ if(e.target===loginOverlay) loginOverlay.classList.add('hidden'); });

  // ---------- Google 登入（如果目前是匿名身分，會盡量把身分「升級」成 Google 帳號，回報/發文紀錄不會不見；
  // 但如果 Supabase 專案沒開「Manual linking」，會自動改用一般登入方式，此時匿名時期的回報記錄可能不會自動接到新帳號上）----------
  document.getElementById('googleLoginBtn').addEventListener('click', async function(){
    const btn = this;
    btn.disabled = true;
    const { data: sessionData } = await sb.auth.getSession();
    const isAnon = sessionData && sessionData.session && sessionData.session.user.is_anonymous;
    const redirectTo = window.location.origin + window.location.pathname;
    let result;
    if(isAnon && typeof sb.auth.linkIdentity === 'function'){
      result = await sb.auth.linkIdentity({ provider: 'google', options: { redirectTo } });
      if(result && result.error && /manual linking/i.test(result.error.message || '')){
        // Supabase 專案沒開啟「Manual linking」，改用一般登入方式，至少讓登入功能能用
        result = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      }
    }else{
      result = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    }
    if(result && result.error){
      console.error('Google 登入失敗', result.error);
      showToast('Google 登入失敗：' + (result.error.message || '請確認 Supabase 是否已設定 Google 登入'), true);
      btn.disabled = false;
    }
    // 成功的話，瀏覽器會被導去 Google 登入頁，登入完成後會自動導回這個網站並完成登入，不用再手動處理
  });
  document.getElementById('sendLoginLinkBtn').onclick = async function(){
    const email = document.getElementById('loginEmail').value.trim();
    if(!email || !email.includes('@')){ showToast('請輸入有效的 Email'); return; }
    const btn = this;
    btn.disabled = true; btn.textContent = '寄送中…';
    const { error } = await sb.auth.updateUser({ email });
    btn.disabled = false; btn.textContent = '寄送登入連結';
    if(error){
      console.error('寄送登入連結失敗', error);
      showToast('寄送失敗：' + (error.message || '請稍後再試'), true);
      return;
    }
    loginOverlay.classList.add('hidden');
    showToast('驗證信已寄出，請到信箱點連結完成登入 📧');
  };

  async function updateLoginUI(){
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    const statusText = document.getElementById('loginStatusText');
    const actionBtn = document.getElementById('loginActionBtn');
    if(user && !user.is_anonymous){
      statusText.textContent = '已登入：' + (user.email || '');
      actionBtn.textContent = '登出';
    }else{
      statusText.textContent = '尚未登入（匿名瀏覽中）';
      actionBtn.textContent = '登入';
    }
  }

  document.getElementById('notifyToggle').addEventListener('change', function(){
    try{ localStorage.setItem('qiongui-notify-pref', this.checked ? '1' : '0'); }catch(e){}
    showToast(this.checked ? '通知已開啟（僅畫面偏好）' : '通知已關閉');
  });
  (function initNotifyToggle(){
    try{
      const v = localStorage.getItem('qiongui-notify-pref');
      document.getElementById('notifyToggle').checked = v === '1';
    }catch(e){}
  })();

  sb.auth.onAuthStateChange((event, session)=>{
    currentUserId = session && session.user ? session.user.id : null;
    if(currentPage==='settingsPage') updateLoginUI();
    if(currentPage==='mapPage') renderAll();
  });

  // ---------- 討論區 ----------
  let posts = [];
  const postOverlay = document.getElementById('postOverlay');
  let postLikedIds = new Set();

  async function loadPosts(){
    const container = document.getElementById('boardContainer');
    const { data, error } = await sb.from('posts').select('*').order('created_at', { ascending:false });
    if(error){
      console.error('讀取討論區失敗', error);
      container.innerHTML = '<div class="empty-state"><span class="stamp">⚠️</span>讀取討論區失敗，請稍後重新整理頁面</div>';
      return;
    }
    posts = data || [];
    if(posts.length===0){
      container.innerHTML = '<div class="empty-state"><span class="stamp">🈳</span>還沒有人發文<br/>快按右下角「✎」當第一個發文的人吧！</div>';
      return;
    }
    container.innerHTML = posts.map(p=>{
      const preview = (p.content||'').length>60 ? p.content.slice(0,60)+'…' : (p.content||'');
      return `<div class="board-post-card" data-post="${p.id}">
        <div class="board-post-title">${escapeHtml(p.title)}</div>
        <div class="board-post-preview">${escapeHtml(preview)}</div>
        <div class="board-post-meta"><span>by ${escapeHtml(p.nickname||'匿名窮鬼')}</span><span>👍 ${p.likes||0}</span></div>
      </div>`;
    }).join('');
    container.querySelectorAll('[data-post]').forEach(card=>{
      card.onclick = ()=> openPostDetail(card.getAttribute('data-post'));
    });
  }

  function openPostModal(){
    document.getElementById('fPostTitle').value='';
    document.getElementById('fPostContent').value='';
    document.getElementById('fPostNick').value='';
    postOverlay.classList.remove('hidden');
  }
  document.getElementById('cancelPostBtn').onclick = ()=> postOverlay.classList.add('hidden');
  postOverlay.addEventListener('click', e=>{ if(e.target===postOverlay) postOverlay.classList.add('hidden'); });

  document.getElementById('submitPostBtn').onclick = async function(){
    const title = document.getElementById('fPostTitle').value.trim();
    const content = document.getElementById('fPostContent').value.trim();
    let nickname = document.getElementById('fPostNick').value.trim();
    if(!title){ showToast('請填寫標題'); return; }
    if(!content){ showToast('請填寫內容'); return; }
    if(!currentUserId){ showToast('連線尚未就緒，請稍後再試', true); return; }
    if(!nickname) nickname = NICKS[Math.floor(Math.random()*NICKS.length)];
    const btn = this;
    btn.disabled = true; btn.textContent = '發布中…';
    const { error } = await sb.from('posts').insert({
      author_id: currentUserId, nickname, title, content
    });
    btn.disabled = false; btn.textContent = '發布';
    if(error){
      console.error('發文失敗', error);
      showToast('發文失敗：' + (error.message || '請稍後再試'), true);
      return;
    }
    postOverlay.classList.add('hidden');
    showToast('發文成功！');
    await loadPosts();
  };

  const postDetailOverlay = document.getElementById('postDetailOverlay');
  postDetailOverlay.addEventListener('click', e=>{ if(e.target===postDetailOverlay) postDetailOverlay.classList.add('hidden'); });

  async function openPostDetail(postId){
    const p = posts.find(x=>x.id===postId);
    if(!p) return;
    const sheet = document.getElementById('postDetailSheet');
    sheet.innerHTML = `
      <div class="board-detail-title">${escapeHtml(p.title)}</div>
      <div class="board-detail-meta">by ${escapeHtml(p.nickname||'匿名窮鬼')}</div>
      <div class="board-detail-content">${escapeHtml(p.content)}</div>
      <div class="board-detail-actions">
        <button class="like-btn ${postLikedIds.has(p.id)?'liked':''}" id="postLikeBtn">👍 ${p.likes||0}</button>
        ${p.author_id===currentUserId ? `<button class="delete-btn" id="postDeleteBtn">🗑️ 刪除文章</button>` : ''}
      </div>
      <div id="commentList"><div class="addr-result-empty">讀取留言中…</div></div>
      <div class="comment-input-row">
        <textarea id="fCommentContent" maxlength="300" placeholder="留言…"></textarea>
        <button class="btn-primary" id="submitCommentBtn" style="flex:0 0 auto; padding:0 16px;">送出</button>
      </div>
    `;
    postDetailOverlay.classList.remove('hidden');

    document.getElementById('postLikeBtn').onclick = ()=> togglePostLike(p.id);
    const deleteBtn = document.getElementById('postDeleteBtn');
    if(deleteBtn) deleteBtn.onclick = ()=> deletePost(p.id);
    document.getElementById('submitCommentBtn').onclick = ()=> submitComment(p.id);

    loadComments(p.id);
  }

  async function togglePostLike(postId){
    if(!currentUserId) return;
    const liked = postLikedIds.has(postId);
    if(liked){
      const { error } = await sb.from('post_likes').delete().eq('post_id', postId).eq('liker_id', currentUserId);
      if(error){ console.error(error); showToast('操作失敗，請稍後再試', true); return; }
      postLikedIds.delete(postId);
    }else{
      const { error } = await sb.from('post_likes').insert({ post_id: postId, liker_id: currentUserId });
      if(error){ console.error(error); showToast('操作失敗，請稍後再試', true); return; }
      postLikedIds.add(postId);
    }
    await loadPosts();
    openPostDetail(postId);
  }

  async function deletePost(postId){
    const ok = window.confirm('確定要刪除這篇文章嗎？刪除後留言也會一併消失，無法復原。');
    if(!ok) return;
    const { error } = await sb.from('posts').delete().eq('id', postId);
    if(error){ console.error(error); showToast('刪除失敗，請稍後再試', true); return; }
    postDetailOverlay.classList.add('hidden');
    showToast('已刪除文章');
    await loadPosts();
  }

  async function loadComments(postId){
    const list = document.getElementById('commentList');
    const { data, error } = await sb.from('comments').select('*').eq('post_id', postId).order('created_at', { ascending:true });
    if(error){ console.error(error); list.innerHTML = '<div class="addr-result-empty">留言讀取失敗</div>'; return; }
    if(!data || data.length===0){ list.innerHTML = '<div class="addr-result-empty">還沒有留言，當第一個留言的人吧！</div>'; return; }
    list.innerHTML = data.map(c=>`
      <div class="comment-item">
        <div class="comment-meta">${escapeHtml(c.nickname||'匿名窮鬼')}</div>
        <div>${escapeHtml(c.content)}</div>
      </div>
    `).join('');
  }

  async function submitComment(postId){
    const input = document.getElementById('fCommentContent');
    const content = input.value.trim();
    if(!content){ showToast('請輸入留言內容'); return; }
    if(!currentUserId){ showToast('連線尚未就緒，請稍後再試', true); return; }
    const nickname = NICKS[Math.floor(Math.random()*NICKS.length)];
    const { error } = await sb.from('comments').insert({ post_id: postId, author_id: currentUserId, nickname, content });
    if(error){ console.error(error); showToast('留言失敗，請稍後再試', true); return; }
    input.value = '';
    await loadComments(postId);
  }

  // ---------- 個人任務／積分儀表板 ----------
  let myPoints = { points:0, checkin_streak:0, last_checkin_date:null, reports_count:0, photo_reports_count:0 };
  const todayTaipei = ()=>{
    // 用台灣時區算「今天」的日期字串，跟資料庫函式的邏輯一致
    return new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Taipei' })).toISOString().slice(0,10);
  };

  async function loadPoints(){
    if(!currentUserId) return;
    const { data, error } = await sb.from('user_points').select('*').eq('user_id', currentUserId).maybeSingle();
    if(error){
      console.error('讀取積分失敗', error);
    }else if(data){
      myPoints = data;
    }else{
      myPoints = { points:0, checkin_streak:0, last_checkin_date:null, reports_count:0, photo_reports_count:0 };
    }
    renderDashboard();
  }

  function renderDashboard(){
    document.getElementById('pointsValue').textContent = (myPoints.points||0) + ' pt';
    const checkinBtn = document.getElementById('checkinBtn');
    const alreadyCheckedIn = myPoints.last_checkin_date === todayTaipei();
    checkinBtn.disabled = alreadyCheckedIn;
    checkinBtn.textContent = alreadyCheckedIn ? '✅ 今日已簽到' : '✅ 今日簽到 +10';
    document.getElementById('checkinStreakText').textContent =
      (myPoints.checkin_streak||0) > 0 ? `已連續簽到 ${myPoints.checkin_streak} 天` : '尚未簽到';

    const reportsCount = myPoints.reports_count || 0;
    const mapPct = Math.min(100, Math.round(reportsCount/5*100));
    document.getElementById('mapTaskDesc').textContent = `已回報 ${Math.min(reportsCount,5)} / 5 家`;
    document.getElementById('mapTaskProgress').style.width = mapPct + '%';

    const cheapCount = restaurants.filter(r=>r.reporterId===currentUserId && r.price<=100).length;
    const cheapPct = Math.min(100, Math.round(cheapCount/7*100));
    document.getElementById('cheapTaskDesc').textContent = `已回報 ${Math.min(cheapCount,7)} / 7 筆`;
    document.getElementById('cheapTaskProgress').style.width = cheapPct + '%';
  }

  document.getElementById('checkinBtn').addEventListener('click', async function(){
    if(!currentUserId){ showToast('連線尚未就緒，請稍後再試', true); return; }
    const btn = this;
    btn.disabled = true;
    const { data, error } = await sb.rpc('daily_checkin');
    if(error){
      console.error('簽到失敗', error);
      showToast('簽到失敗：' + (error.message || '請稍後再試'), true);
      btn.disabled = false;
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if(result && result.success){
      showToast(`簽到成功！+10 pt（連續 ${result.streak} 天）`);
    }else{
      showToast('今天已經簽到過囉，明天再來！');
    }
    await loadPoints();
  });

  // 積分兌換商店尚未開放（等後續談好店家合作、核銷方式後再加回前端入口）。
  // 後端的 redeem_points() 函式先保留在資料庫裡，之後要開放時不用再改資料庫結構。

  (async function init(){
    initMap();
    await ensureAuth();
    await loadData();
    updateLoginUI();
  })();
})();
