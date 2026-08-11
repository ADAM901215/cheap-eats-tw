(function(){
  const CATS = ['全部','早餐','正餐','小吃','飲料','宵夜'];
  const CAT_EMOJI = {'早餐':'🥯','正餐':'🍚','小吃':'🍢','飲料':'🥤','宵夜':'🌙'};
  const NICKS = ['省錢戰士','小資魂','摳門大師','荷包守護者','CP值獵人','窮遊冠軍'];
  const PHOTO_BUCKET = 'photos';

  // ---------- Supabase client ----------
  if(!window.supabase || !window.SUPABASE_URL || window.SUPABASE_URL.indexOf('請貼上') === 0){
    document.addEventListener('DOMContentLoaded', function(){
      document.getElementById('listContainer').innerHTML =
        '<div class="empty-state"><span class="stamp">⚠️</span>還沒有設定 Supabase 連線資訊<br/>請打開 config.js，貼上你的 Supabase 網址與 anon key</div>';
    });
    return;
  }
  if(!window.GOOGLE_MAPS_API_KEY || window.GOOGLE_MAPS_API_KEY.indexOf('請貼上') === 0){
    document.addEventListener('DOMContentLoaded', function(){
      document.getElementById('listContainer').innerHTML =
        '<div class="empty-state"><span class="stamp">⚠️</span>還沒有設定 Google Maps API 金鑰<br/>請打開 config.js，貼上你的 GOOGLE_MAPS_API_KEY</div>';
    });
    return;
  }
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  let restaurants = [];
  let state = { category:'全部', sort:'rating', search:'' };
  let map, pickMap, pickMarker, geocoder;
  let mapMarkers = []; // { id, marker, infoWindow }
  let likedIds = new Set(); // 階段一：僅前端本次瀏覽期間記憶，尚未寫入資料庫
  let currentUserId = null;

  function tierInfo(price){
    if(price<=80) return {color:'#3F7A5E', label:'超佛心'};
    if(price<=150) return {color:'#E7A93E', label:'俗擱大碗'};
    return {color:'#C8342D', label:'划算頂規'};
  }

  function starString(n){
    return '★★★★★☆☆☆☆☆'.slice(5-n,10-n);
  }

  // ---------- 動態載入 Google Maps JavaScript API ----------
  function loadGoogleMaps(){
    return new Promise((resolve, reject)=>{
      if(window.google && window.google.maps){ resolve(); return; }
      window.__gmapsReady = function(){ resolve(); };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(window.GOOGLE_MAPS_API_KEY)}&language=zh-TW&region=TW&callback=__gmapsReady`;
      script.async = true;
      script.defer = true;
      script.onerror = ()=>reject(new Error('Google Maps 載入失敗'));
      document.head.appendChild(script);
    });
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
  async function loadData(){
    const { data, error } = await sb
      .from('restaurants')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending:false });
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
      createdAt: new Date(r.created_at).getTime()
    }));
    renderAll();
  }

  function initMap(){
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat:25.0478, lng:121.5319 },
      zoom: 13,
      disableDefaultUI: false,
      fullscreenControl: false,
      streetViewControl: false,
      mapTypeControl: false
    });
    geocoder = new google.maps.Geocoder();
  }

  // 藥丸形價格標籤（類似 Google/Naver 地圖上直接顯示價格的標記樣式）
  function makeMarkerIcon(r){
    const t = tierInfo(r.price);
    const label = '$' + r.price;
    const height = 28;
    const paddingX = 12;
    const charW = 8.3;
    const textW = Math.max(label.length * charW, 18);
    const width = Math.round(textW + paddingX * 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="1.5" y="1.5" width="${width-3}" height="${height-3}" rx="${(height-3)/2}" fill="#FFFFFF" stroke="${t.color}" stroke-width="2.5"/>
      <text x="${width/2}" y="${height/2+4.5}" font-family="'JetBrains Mono',monospace" font-size="13" font-weight="700" fill="${t.color}" text-anchor="middle">${label}</text>
    </svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(width, height),
      anchor: new google.maps.Point(width/2, height/2)
    };
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
    mapMarkers.forEach(entry => entry.marker.setMap(null));
    mapMarkers = [];
    list.forEach(r=>{
      const t = tierInfo(r.price);
      const marker = new google.maps.Marker({
        position: { lat:r.lat, lng:r.lng },
        map,
        icon: makeMarkerIcon(r),
        title: r.dishName
      });
      const infoWindow = new google.maps.InfoWindow({
        content: `<div style="min-width:170px;">
          <strong>${escapeHtml(r.dishName)}</strong>　<span style="font-family:'JetBrains Mono',monospace; font-weight:700;">$${r.price}</span><br/>
          <span style="font-size:12px; color:#4A443B;">${escapeHtml(r.storeName)}</span><br/>
          <span style="color:${t.color}; font-weight:700; font-size:12px;">${t.label}</span>　${starString(r.rating)}<br/>
          <span style="font-size:12.5px;">${escapeHtml(r.comment||'')}</span><br/>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}" target="_blank" rel="noopener" style="font-size:12.5px;">🧭 導航前往</a>
        </div>`
      });
      marker.addListener('click', ()=> infoWindow.open({ anchor:marker, map }));
      mapMarkers.push({ id:r.id, marker, infoWindow });
    });
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
            <div class="ticket-store">${escapeHtml(r.storeName)}${r.isVerified? '<span class="verified-badge">✓ 店家認證</span>':''}</div>
          </div>
          <span class="tier-tag" style="background:${t.color}">${t.label}</span>
        </div>
        <p class="ticket-comment">「${escapeHtml(r.comment||'')}」</p>
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
    document.getElementById('map').scrollIntoView({behavior:'smooth', block:'center'});
    map.panTo({ lat:r.lat, lng:r.lng });
    map.setZoom(16);
    setTimeout(()=>{
      const entry = mapMarkers.find(m=>m.id===id);
      if(entry) entry.infoWindow.open({ anchor:entry.marker, map });
    }, 500);
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

  // ---------- Add restaurant modal ----------
  let chosenRating = 0;
  let chosenPhotoFile = null;
  const overlay = document.getElementById('overlay');

  function openModal(){
    overlay.classList.remove('hidden');
    document.getElementById('fStore').value='';
    document.getElementById('fDish').value='';
    document.getElementById('fPrice').value='';
    document.getElementById('fComment').value='';
    document.getElementById('fNick').value='';
    document.getElementById('fPhoto').value='';
    chosenPhotoFile = null;
    document.getElementById('fAddressSearch').value='';
    document.getElementById('addressResults').classList.add('hidden');
    document.getElementById('addressResults').innerHTML='';
    document.getElementById('priceHint').textContent = '超過 200 就不是「俗擱大碗」囉，上限 200 元';
    document.getElementById('priceHint').classList.remove('err');
    chosenRating = 0;
    updateStarPicker();
    setTimeout(()=>{
      const center = map.getCenter();
      if(!pickMap){
        pickMap = new google.maps.Map(document.getElementById('pickMap'), {
          center: { lat:center.lat(), lng:center.lng() },
          zoom: 15,
              disableDefaultUI: true,
          zoomControl: true
        });
        pickMarker = new google.maps.Marker({
          position: { lat:center.lat(), lng:center.lng() },
          map: pickMap,
          draggable: true
        });
        pickMap.addListener('click', e=> pickMarker.setPosition(e.latLng));
      }else{
        pickMap.setCenter({ lat:center.lat(), lng:center.lng() });
        pickMap.setZoom(15);
        pickMarker.setPosition({ lat:center.lat(), lng:center.lng() });
        google.maps.event.trigger(pickMap, 'resize');
      }
    }, 60);
  }

  function closeModal(){ overlay.classList.add('hidden'); }

  // ---------- 地址／店名搜尋自動定位（使用 Google Maps 的 Geocoder）----------
  let addressSearchBusy = false;
  function searchAddress(){
    const input = document.getElementById('fAddressSearch');
    const resultsBox = document.getElementById('addressResults');
    const q = input.value.trim();
    if(!q){ resultsBox.classList.add('hidden'); resultsBox.innerHTML=''; return; }
    if(addressSearchBusy) return;
    addressSearchBusy = true;
    resultsBox.classList.remove('hidden');
    resultsBox.innerHTML = '<div class="addr-result-empty">搜尋中…</div>';

    const center = pickMap ? pickMap.getCenter() : map.getCenter();
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat:center.lat()-0.2, lng:center.lng()-0.2 });
    bounds.extend({ lat:center.lat()+0.2, lng:center.lng()+0.2 });

    geocoder.geocode({ address:q, bounds, componentRestrictions:{ country:'TW' } }, (results, status)=>{
      addressSearchBusy = false;
      if(status!=='OK' || !results || results.length===0){
        resultsBox.innerHTML = '<div class="addr-result-empty">找不到符合的地點，換個關鍵字試試，或直接在地圖上點選位置</div>';
        return;
      }
      resultsBox.innerHTML = results.map((r,i)=>`<div class="addr-result-item" data-i="${i}">${escapeHtml(r.formatted_address)}</div>`).join('');
      resultsBox.querySelectorAll('.addr-result-item').forEach(el=>{
        el.onclick = ()=>{
          const r = results[parseInt(el.getAttribute('data-i'))];
          const loc = r.geometry.location;
          if(pickMap){
            pickMap.setCenter(loc);
            pickMap.setZoom(17);
            pickMarker.setPosition(loc);
          }
          resultsBox.classList.add('hidden');
          resultsBox.innerHTML='';
        };
      });
    });
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
    chosenPhotoFile = this.files && this.files[0] ? this.files[0] : null;
  });

  document.getElementById('fPrice').addEventListener('input', function(){
    const v = parseInt(this.value);
    const hint = document.getElementById('priceHint');
    if(v>200){ hint.textContent='超過 200 元無法送出，請確認金額'; hint.classList.add('err'); }
    else { hint.textContent='超過 200 就不是「俗擱大碗」囉，上限 200 元'; hint.classList.remove('err'); }
  });

  async function uploadPhotoIfAny(){
    if(!chosenPhotoFile) return null;
    const ext = (chosenPhotoFile.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${currentUserId}/${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, chosenPhotoFile, {
      cacheControl: '3600',
      upsert: false
    });
    if(error){
      console.error('照片上傳失敗', error);
      showToast('照片上傳失敗，其他資料仍會送出', true);
      return null;
    }
    const { data } = sb.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    return data ? data.publicUrl : null;
  }

  document.getElementById('submitAddBtn').onclick = async function(){
    const submitBtn = this;
    const storeName = document.getElementById('fStore').value.trim();
    const dishName = document.getElementById('fDish').value.trim();
    const category = document.getElementById('fCategory').value;
    const price = parseInt(document.getElementById('fPrice').value);
    const comment = document.getElementById('fComment').value.trim();
    let nickname = document.getElementById('fNick').value.trim();

    if(!storeName){ showToast('請填寫店名'); return; }
    if(!dishName){ showToast('請填寫招牌品項名稱'); return; }
    if(!price || price<1 || price>200){ showToast('價格請填 1～200 之間'); return; }
    if(chosenRating===0){ showToast('請給個評分'); return; }
    if(!currentUserId){ showToast('連線尚未就緒，請稍後再試', true); return; }
    if(!nickname) nickname = NICKS[Math.floor(Math.random()*NICKS.length)];

    const pos = pickMarker.getPosition();

    submitBtn.disabled = true;
    submitBtn.textContent = '送出中…';

    const photoUrl = await uploadPhotoIfAny();

    const { data, error } = await sb.from('restaurants').insert({
      store_name: storeName,
      dish_name: dishName,
      category, price, rating: chosenRating, comment,
      lat: pos.lat(), lng: pos.lng(),
      nickname,
      reporter_id: currentUserId,
      photo_url: photoUrl
    }).select().single();

    submitBtn.disabled = false;
    submitBtn.textContent = '蓋章送出';

    if(error){
      console.error('送出失敗', error);
      showToast('送出失敗：' + (error.message || '請稍後再試'), true);
      return;
    }

    closeModal();
    await loadData();
    showToast('蓋章成功！感謝你的回報 🎫');
    setTimeout(()=>locateOnMap(data.id), 300);
  };

  // ---------- Filters / search / sort ----------
  document.getElementById('searchInput').addEventListener('input', function(){
    state.search = this.value.trim();
    renderAll();
  });
  document.getElementById('sortSelect').addEventListener('change', function(){
    state.sort = this.value;
    renderAll();
  });
  document.getElementById('locateBtn').addEventListener('click', function(){
    if(!navigator.geolocation){ showToast('這個瀏覽器不支援定位'); return; }
    navigator.geolocation.getCurrentPosition(
      pos=>{
        map.panTo({ lat:pos.coords.latitude, lng:pos.coords.longitude });
        map.setZoom(15);
      },
      ()=>{ showToast('無法取得你的位置'); }
    );
  });

  (async function init(){
    try{
      await loadGoogleMaps();
    }catch(e){
      console.error(e);
      document.getElementById('listContainer').innerHTML =
        '<div class="empty-state"><span class="stamp">⚠️</span>Google 地圖載入失敗，請確認 config.js 裡的金鑰是否正確</div>';
      return;
    }
    initMap();
    await ensureAuth();
    await loadData();
  })();
})();
