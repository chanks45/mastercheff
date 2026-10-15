(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var cockpit = $('cockpit');
  var menu = $('settingsMenu');
  var hint = $('settingsHint');
  var closeSettings = $('closeSettings');

  var STORAGE_KEY = 'speedoHudLayout';
  var SPEED_LIMIT = 60;      // batas panik (angka di layar)
  var REDLINE = 0.85;        // 85% RPM
  var MAX_RPM = 8000;
  var THEMES = ['theme-classic', 'theme-spicy', 'theme-charcoal'];
  var THEME_NAMES = ['Classic Cheese Burger', 'Spicy Red Patty', 'Charcoal Black Burger'];

  /* ================= STATE ================= */
  var S = {
    engine: false,
    speed: 0,       // sesuai satuan terpilih
    speedMS: 0,
    kmh: 0,         // selalu km/h (untuk overspeed)
    speedMode: 0,   // 0: KMH, 1: MPH, 2: Knots
    rpm: 0,
    fuel: 100,
    health: 100,
    gear: 'N',
    lights: 0,
    left: false,
    right: false,
    belt: false,
    locked: false,
    odo: 0
  };

  var L = { tx: 0, ty: 0, scale: 1, theme: 0 };
  var mode = null;

  var elements = {
    engine: $('engine'),
    speed: $('speed'),
    rpm: $('rpm'),
    fuel: $('fuel'),
    health: $('health'),
    gear: $('gear'),
    headlights: $('headlights'),
    indicators: $('indicators'),
    seatbelts: $('seatbelts'),
    odometer: $('odometer')
  };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function num(v, d) { v = Number(v); return isNaN(v) ? (d || 0) : v; }
  var onOrOff = function (s) { return s ? 'On' : 'Off'; };

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = String(value);
  }

  /* ================= SISTEM YOUTUBE ONLINE ================= */
  var MUSIC_STORAGE_KEY = 'samc_music_playlist_v1';
  var musicPlayer = null;
  var musicApiReady = false;
  var musicReady = false;
  var musicPlaylist = [];
  var musicIndex = -1;
  var musicRepeat = false;
  var musicShuffle = false;
  var musicProgressTimer = null;
  var musicPendingLoad = null;

  function formatMusicTime(seconds) {
    var n = Math.max(0, Math.floor(Number(seconds) || 0));
    var m = Math.floor(n / 60);
    var s = String(n % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function extractYouTubeSource(input) {
    var raw = String(input || '').trim();
    if (!raw) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return { type: 'video', id: raw };
    try {
      var url = new URL(raw);
      var host = url.hostname.toLowerCase();
      var isYoutube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be');
      if (!isYoutube) return null;
      var watchId = url.searchParams.get('v');
      if (watchId && /^[a-zA-Z0-9_-]{11}$/.test(watchId)) return { type: 'video', id: watchId };
      var parts = url.pathname.split('/').filter(Boolean);
      var idx = parts.findIndex(function (p) { return ['embed', 'shorts', 'live'].includes(p); });
      if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) return { type: 'video', id: parts[idx + 1] };
      if (host === 'youtu.be' && parts[0] && /^[a-zA-Z0-9_-]{11}$/.test(parts[0])) return { type: 'video', id: parts[0] };
    } catch (_) {}
    return null;
  }

  function youtubeThumbnail(id) {
    return 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg';
  }

  function loadMusicPlaylist() {
    try {
      var raw = localStorage.getItem(MUSIC_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        musicPlaylist = parsed.filter(function (item) { return item && item.id; }).map(function (item) {
          return { id: String(item.id), title: String(item.title || 'YouTube Track') };
        });
      }
    } catch (_) {
      musicPlaylist = [];
    }
  }

  function saveMusicPlaylist() {
    try { localStorage.setItem(MUSIC_STORAGE_KEY, JSON.stringify(musicPlaylist)); } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderMusicPlaylist() {
    var list = $('music-playlist');
    if (!list) return;
    list.innerHTML = '';
    if (!musicPlaylist.length) {
      var empty = document.createElement('div');
      empty.className = 'music-empty';
      empty.textContent = 'Playlist kosong. Tekan + untuk menambah lagu.';
      list.appendChild(empty);
      return;
    }
    musicPlaylist.forEach(function (track, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row' + (index === musicIndex ? ' active' : '');
      row.innerHTML =
        '<span class="music-track-thumb"><img src="' + youtubeThumbnail(track.id) + '" alt=""></span>' +
        '<span class="music-track-copy"><strong>' + escapeHtml(track.title) + '</strong></span>' +
        '<span class="music-track-index">' + String(index + 1).padStart(2, '0') + '</span>';
      row.addEventListener('click', function () { playMusicIndex(index); });
      list.appendChild(row);
    });
  }

  function updateMusicMeta() {
    var title = $('music-track-title');
    var subtitle = $('music-track-subtitle');
    var cover = $('music-cover');
    var placeholder = $('music-player-placeholder');
    var track = musicPlaylist[musicIndex];

    if (title) title.textContent = track ? track.title : 'Belum ada lagu';
    if (subtitle) subtitle.textContent = track ? 'YouTube • Playing' : 'Online Playback';
    if (cover) {
      if (track) {
        cover.src = youtubeThumbnail(track.id);
        cover.classList.add('show');
        cover.onerror = function () { cover.classList.remove('show'); };
      } else {
        cover.removeAttribute('src');
        cover.classList.remove('show');
      }
    }
    if (placeholder) placeholder.classList.toggle('hide', !!track);
    renderMusicPlaylist();
    updateMiniPill();
  }

  function updateMusicPlayButton() {
    var btn = $('btn-music-play');
    if (!btn) return;
    var state = musicPlayer && typeof musicPlayer.getPlayerState === 'function' ? musicPlayer.getPlayerState() : -1;
    btn.textContent = state === 1 ? '❚❚' : '▶';
    syncAudioVisualPulse();
  }

  function startMusicProgressLoop() {
    if (musicProgressTimer) return;
    musicProgressTimer = setInterval(function () {
      if (!musicPlayer || !musicReady) return;
      var current = 0, duration = 0;
      try {
        current = Number(musicPlayer.getCurrentTime()) || 0;
        duration = Number(musicPlayer.getDuration()) || 0;
      } catch (_) { return; }
      var progress = $('music-progress');
      var now = $('music-current-time');
      var end = $('music-duration');
      if (now) now.textContent = formatMusicTime(current);
      if (end) end.textContent = formatMusicTime(duration);
      if (progress) progress.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
    }, 250);
  }

  function ensureYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      musicApiReady = true;
      initializeYouTubePlayer();
      return;
    }
    if (window.__samcYouTubeApiLoading) return;
    window.__samcYouTubeApiLoading = true;
    window.onYouTubeIframeAPIReady = function () {
      musicApiReady = true;
      initializeYouTubePlayer();
    };
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = function () {
      var subtitle = $('music-track-subtitle');
      if (subtitle) subtitle.textContent = 'API gagal dimuat. Cek koneksi internet.';
    };
    document.head.appendChild(tag);
  }

  function initializeYouTubePlayer() {
    if (!musicApiReady || musicPlayer || !$('youtube-player')) return;
    musicPlayer = new YT.Player('youtube-player', {
      width: '90',
      height: '52',
      videoId: musicPlaylist[0] ? musicPlaylist[0].id : '',
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        controls: 0,
        fs: 0,
        disablekb: 1,
        origin: window.location.origin
      },
      events: {
        onReady: function (event) {
          musicReady = true;
          event.target.setVolume(Number($('music-volume')?.value || 80));
          $('music-player-placeholder')?.classList.toggle('hide', !!musicPlaylist.length);
          updateMusicPlayButton();
          startMusicProgressLoop();
          if (musicPendingLoad !== null) {
            var pending = musicPendingLoad;
            musicPendingLoad = null;
            playMusicIndex(pending);
          }
        },
        onStateChange: function (event) {
          if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) {
            activeAudioSource = 'youtube'; hasAudioActivated = true; miniPillDismissed = false;
            pauseRadioIfNeeded();
          }
          updateMusicPlayButton();
          if (event.data === YT.PlayerState.ENDED) {
            playNextMusic(true);
          }
          var placeholder = $('music-player-placeholder');
          if (placeholder) placeholder.classList.toggle('hide', event.data !== YT.PlayerState.UNSTARTED || !musicPlaylist.length);
        },
        onError: function () {
          var subtitle = $('music-track-subtitle');
          if (subtitle) subtitle.textContent = 'Lagu diblokir / tidak dapat diputar.';
        }
      }
    });
  }

  function addMusicTrack(input, titleOverride) {
    var source = extractYouTubeSource(input);
    if (!source || source.type !== 'video') {
      alert('Masukkan link YouTube / ID 11 karakter yang valid.');
      return false;
    }
    var title = String(titleOverride || '').trim() || ('YouTube • ' + source.id);
    var existing = musicPlaylist.findIndex(function (item) { return item.id === source.id; });
    if (existing === -1) {
      musicPlaylist.push({ id: source.id, title: title });
      musicIndex = musicPlaylist.length - 1;
    } else {
      musicIndex = existing;
    }
    saveMusicPlaylist();
    renderMusicPlaylist();
    updateMusicMeta();
    playMusicIndex(musicIndex);
    return true;
  }

  function playMusicIndex(index) {
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= musicPlaylist.length) return;
    activeAudioSource = 'youtube'; hasAudioActivated = true; miniPillDismissed = false;
    pauseRadioIfNeeded();
    musicIndex = index;
    updateMusicMeta();

    if (!musicReady) {
      musicPendingLoad = index;
      ensureYouTubeAPI();
      return;
    }
    var track = musicPlaylist[index];
    try {
      musicPlayer.loadVideoById(track.id);
      musicPlayer.playVideo();
    } catch (_) {}

    $('music-player-placeholder')?.classList.add('hide');
  }

  function toggleMusicPlayback() {
    activeAudioSource = 'youtube'; hasAudioActivated = true; miniPillDismissed = false;
    if (!musicReady) {
      if (!musicPlaylist.length) {
        menu.classList.add('open');
        $('tabBtnYoutube')?.click();
        $('music-add-row')?.classList.remove('hide');
        $('music-url-input')?.focus();
        return;
      }
      pauseRadioIfNeeded();
      ensureYouTubeAPI();
      if (musicIndex < 0) musicIndex = 0;
      musicPendingLoad = musicIndex;
      updateMiniPill();
      return;
    }
    if (musicPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
      musicPlayer.pauseVideo();
    } else {
      pauseRadioIfNeeded();
      musicPlayer.playVideo();
    }
  }

  function playNextMusic(auto) {
    if (!musicPlaylist.length) return;
    if (musicRepeat && musicIndex >= 0) {
      playMusicIndex(musicIndex);
      return;
    }
    var next;
    if (musicShuffle && musicPlaylist.length > 1) {
      do { next = Math.floor(Math.random() * musicPlaylist.length); } while (next === musicIndex);
    } else {
      next = musicIndex + 1;
      if (next >= musicPlaylist.length) {
        next = 0;
      }
    }
    playMusicIndex(next);
  }

  function playPrevMusic() {
    if (!musicPlaylist.length) return;
    var prev = musicIndex - 1;
    if (prev < 0) prev = musicPlaylist.length - 1;
    playMusicIndex(prev);
  }

  function setupMusicPlayer() {
    var play = $('btn-music-play');
    var next = $('btn-music-next');
    var prev = $('btn-music-prev');
    var mute = $('btn-music-mute');
    var volume = $('music-volume');
    var progress = $('music-progress');
    var addToggle = $('btn-music-add-toggle');
    var addRow = $('music-add-row');
    var addBtn = $('btn-music-add');
    var urlInput = $('music-url-input');
    var titleInput = $('music-title-input');
    var clear = $('btn-music-clear');
    var repeat = $('btn-music-repeat');
    var shuffle = $('btn-music-shuffle');

    loadMusicPlaylist();
    musicIndex = musicPlaylist.length ? 0 : -1;
    renderMusicPlaylist();
    updateMusicMeta();
    startMusicProgressLoop();

    if (play) play.addEventListener('click', function (e) { e.stopPropagation(); toggleMusicPlayback(); });
    if (next) next.addEventListener('click', function (e) { e.stopPropagation(); playNextMusic(false); });
    if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); playPrevMusic(); });

    if (volume) volume.addEventListener('input', function () {
      if (musicPlayer && musicReady) musicPlayer.setVolume(Number(volume.value));
    });

    if (mute) mute.addEventListener('click', function () {
      if (!musicPlayer || !musicReady) return;
      if (musicPlayer.isMuted()) {
        musicPlayer.unMute();
        mute.textContent = '🔊';
      } else {
        musicPlayer.mute();
        mute.textContent = '🔇';
      }
    });

    if (progress) progress.addEventListener('input', function () {
      if (!musicPlayer || !musicReady) return;
      var duration = Number(musicPlayer.getDuration()) || 0;
      if (duration > 0) musicPlayer.seekTo((Number(progress.value) / 1000) * duration, true);
    });

    if (addToggle) addToggle.addEventListener('click', function () {
      addRow?.classList.toggle('hide');
      urlInput?.focus();
    });

    var addFromInputs = function () {
      if (addMusicTrack(urlInput?.value || '', titleInput?.value || '')) {
        if (urlInput) urlInput.value = '';
        if (titleInput) titleInput.value = '';
        addRow?.classList.add('hide');
      }
    };

    if (addBtn) addBtn.addEventListener('click', addFromInputs);
    [urlInput, titleInput].forEach(function (el) {
      el?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addFromInputs();
      });
    });

    if (clear) clear.addEventListener('click', function () {
      musicPlaylist = [];
      musicIndex = -1;
      saveMusicPlaylist();
      renderMusicPlaylist();
      updateMusicMeta();
      if (musicPlayer && musicReady) musicPlayer.stopVideo();
      syncAudioVisualPulse();
    });

    if (repeat) repeat.addEventListener('click', function () {
      musicRepeat = !musicRepeat;
      repeat.classList.toggle('active', musicRepeat);
    });

    if (shuffle) shuffle.addEventListener('click', function () {
      musicShuffle = !musicShuffle;
      shuffle.classList.toggle('active', musicShuffle);
    });

    if (musicPlaylist.length) ensureYouTubeAPI();
  }

/* ================= RADIO FM, MINI PILL, CHIME SEATBELT, SINKRONISASI AUDIO ================= */
  var RADIO_STORAGE_KEY = 'samc_radio_custom_stations_v1';
  var defaultStations = [
    { name: 'Delta FM', url: 'https://s1.cloudmu.id/listen/delta_fm/radio.mp3' },
    { name: 'Prambors FM', url: 'https://s2.cloudmu.id/listen/prambors/radio.aac' },
    { name: 'I Radio', url: 'https://stream.radiojar.com/4ywdgup3bnzuv' },
    { name: 'Female Radio', url: 'https://s1.cloudmu.id/listen/female_radio/radio.mp3' },
    { name: 'KPOP Radio', url: 'https://stream9.mexiserver.com:7122/stream' },
    { name: 'Kiss FM', url: 'https://live.kissfmmedan.com/kissfm.mp3' },
    { name: 'JGRP Radio', url: 'https://s7.alhastream.com/radio/8350/live' },
    { name: 'Hits Radio', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/977_HITS_SC' },
    { name: 'Hits Love', url: 'https://radio2.vip-radios.fm:18012/stream-128kmp3-HitsLove' }
  ];
  var customStations = [];
  var stations = defaultStations.slice();
  var radioAudio = new Audio();
  radioAudio.preload = 'none';
  radioAudio.volume = 0.8;
  var currentStationIndex = 0;
  var isRadioPlaying = false;
  var activeAudioSource = 'radio';
  var hasAudioActivated = false;
  var miniPillDismissed = false;

  var prevEngine = false, prevHealth = 100, prevLocked = null;
  var bootUntil = 0, impactTimer = null, lockSnapTimer = null;

  /* Chime seatbelt lembut (587Hz & 880Hz) */
  var audioCtx = null, beltTimer = null;
  function playBeltChime() {
    if (S.belt || !S.engine) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var now = audioCtx.currentTime;
      [{ f: 587, d: 0, t: 0.22 }, { f: 880, d: 0.18, t: 0.32 }].forEach(function (n) {
        var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.f, now + n.d);
        g.gain.setValueAtTime(0.0001, now + n.d);
        g.gain.linearRampToValueAtTime(0.045, now + n.d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + n.d + n.t);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(now + n.d); osc.stop(now + n.d + n.t + 0.02);
      });
    } catch (e) {}
  }
  function updateBeltBeep() {
    if (!S.belt && S.engine) {
      if (!beltTimer) { playBeltChime(); beltTimer = setInterval(playBeltChime, 2600); }
    } else if (beltTimer) { clearInterval(beltTimer); beltTimer = null; }
  }

  /* Mini pill & anti-bentrok */
  function isYouTubePlaying() {
    return !!(musicPlayer && musicReady && typeof musicPlayer.getPlayerState === 'function' && musicPlayer.getPlayerState() === 1);
  }
  function updateMiniPill() {
    var pill = $('mini-music-pill');
    if (!pill) return;
    var yt = isYouTubePlaying(), any = isRadioPlaying || yt;
    if (isRadioPlaying) { activeAudioSource = 'radio'; hasAudioActivated = true; miniPillDismissed = false; }
    else if (yt) { activeAudioSource = 'youtube'; hasAudioActivated = true; miniPillDismissed = false; }
    pill.classList.toggle('show', hasAudioActivated && !miniPillDismissed);
    pill.classList.toggle('playing', any);
    var badge = $('miniSourceBadge');
    if (badge) {
      badge.textContent = activeAudioSource === 'youtube' ? '▶ YT' : '📻 RADIO';
      badge.className = 'mini-source-badge ' + (activeAudioSource === 'youtube' ? 'yt-mode' : 'radio-mode');
    }
    var title = activeAudioSource === 'youtube'
      ? (musicPlaylist[musicIndex] ? musicPlaylist[musicIndex].title : 'YouTube Track')
      : (stations[currentStationIndex] ? stations[currentStationIndex].name : 'Radio FM');
    setText('miniTrackTitle', title);
    setText('btn-mini-play', any ? '❚❚' : '▶');
  }
  function syncAudioVisualPulse() {
    cockpit.classList.toggle('music-playing', isRadioPlaying || isYouTubePlaying());
    cockpit.classList.toggle('radio-active', isRadioPlaying);
    updateMiniPill();
  }
  function pauseYouTubeIfNeeded() {
    if (musicPlayer && musicReady && typeof musicPlayer.pauseVideo === 'function') {
      try { var st = musicPlayer.getPlayerState(); if (st === 1 || st === 3) musicPlayer.pauseVideo(); } catch (_) {}
    }
    updateMusicPlayButton();
  }
  function pauseRadioIfNeeded() {
    if (!radioAudio.paused || isRadioPlaying) {
      radioAudio.pause();
      isRadioPlaying = false;
      updateRadioUI('Paused');
    }
  }

  /* Radio FM */
  function rebuildStations() {
    stations = defaultStations.concat(customStations);
    if (currentStationIndex >= stations.length) currentStationIndex = Math.max(0, stations.length - 1);
  }
  function loadCustomStations() {
    try {
      var parsed = JSON.parse(localStorage.getItem(RADIO_STORAGE_KEY) || '[]');
      customStations = Array.isArray(parsed)
        ? parsed.filter(function (i) { return i && i.url; }).map(function (i) { return { name: String(i.name || 'Custom Radio'), url: String(i.url).trim(), isCustom: true }; })
        : [];
    } catch (_) { customStations = []; }
    rebuildStations();
  }
  function saveCustomStations() {
    try { localStorage.setItem(RADIO_STORAGE_KEY, JSON.stringify(customStations)); } catch (_) {}
  }
  function validStreamUrl(v) {
    try { var u = new URL(String(v || '').trim()); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null; } catch (_) { return null; }
  }
  function renderRadioList() {
    var sel = $('stationSelect');
    if (sel) {
      sel.innerHTML = '';
      stations.forEach(function (st, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = (i + 1) + '. ' + st.name + (st.isCustom ? ' ★' : '');
        sel.appendChild(o);
      });
      sel.value = String(currentStationIndex);
    }
    var list = $('radio-playlist');
    if (!list) return;
    list.innerHTML = '';
    stations.forEach(function (st, i) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row' + (i === currentStationIndex ? ' active' : '');
      row.innerHTML =
        '<span class="radio-track-badge' + (st.isCustom ? ' custom' : '') + '">' + (st.isCustom ? 'CUSTOM' : 'FM') + '</span>' +
        '<span class="music-track-copy"><strong>' + escapeHtml(st.name) + '</strong></span>' +
        '<span class="music-track-index">' + String(i + 1).padStart(2, '0') + '</span>' +
        (st.isCustom ? '<span class="track-del-btn" data-del-radio="' + (i - defaultStations.length) + '" title="Hapus saluran ini">×</span>' : '');
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        var del = e.target.closest('[data-del-radio]');
        if (del) removeCustomStation(Number(del.getAttribute('data-del-radio')));
        else loadAndPlayRadio(i);
      });
      list.appendChild(row);
    });
  }
  function updateRadioUI(status) {
    var st = stations[currentStationIndex] || stations[0];
    if (st) setText('stationName', st.name);
    if (status) setText('radioStatus', status);
    setText('btn-radio-play', isRadioPlaying ? '❚❚' : '▶');
    renderRadioList();
    syncAudioVisualPulse();
  }
  function addCustomStation(urlInput, nameInput) {
    var url = validStreamUrl(urlInput);
    if (!url) { alert('Masukkan link streaming radio (http:// atau https://) yang valid.'); return false; }
    var ex = stations.findIndex(function (i) { return i.url.toLowerCase() === url.toLowerCase(); });
    if (ex !== -1) { loadAndPlayRadio(ex); return true; }
    var title = String(nameInput || '').trim();
    if (!title) { try { title = 'Radio • ' + new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { title = 'Radio • ' + (customStations.length + 1); } }
    customStations.push({ name: title, url: url, isCustom: true });
    saveCustomStations();
    rebuildStations();
    loadAndPlayRadio(stations.length - 1);
    return true;
  }
  function removeCustomStation(ci) {
    if (ci < 0 || ci >= customStations.length) return;
    var gi = defaultStations.length + ci, wasCurrent = currentStationIndex === gi;
    customStations.splice(ci, 1);
    saveCustomStations();
    rebuildStations();
    if (wasCurrent) {
      currentStationIndex = 0;
      if (isRadioPlaying) { loadAndPlayRadio(0); return; }
      radioAudio.pause(); radioAudio.removeAttribute('src');
      updateRadioUI('Stopped');
    } else if (currentStationIndex > gi) {
      currentStationIndex--;
    }
    updateRadioUI();
  }
  function loadAndPlayRadio(index) {
    if (!stations.length) return;
    if (index < 0) index = stations.length - 1;
    if (index >= stations.length) index = 0;
    currentStationIndex = index;
    activeAudioSource = 'radio'; hasAudioActivated = true; miniPillDismissed = false;
    pauseYouTubeIfNeeded();
    try {
      radioAudio.pause();
      radioAudio.src = stations[index].url;
      radioAudio.load();
      isRadioPlaying = false;
      updateRadioUI('Loading...');
      var p = radioAudio.play();
      if (p && typeof p.then === 'function') {
        p.then(function () { isRadioPlaying = true; updateRadioUI('Now Playing'); })
         .catch(function () { isRadioPlaying = false; updateRadioUI('Stream Error / Offline'); });
      }
    } catch (e) { isRadioPlaying = false; updateRadioUI('Stopped'); }
  }
  function toggleRadioPlayback() {
    activeAudioSource = 'radio'; hasAudioActivated = true; miniPillDismissed = false;
    if (isRadioPlaying && !radioAudio.paused) {
      radioAudio.pause(); isRadioPlaying = false; updateRadioUI('Paused');
    } else if (!radioAudio.src) {
      loadAndPlayRadio(currentStationIndex);
    } else {
      pauseYouTubeIfNeeded();
      updateRadioUI('Loading...');
      radioAudio.play().then(function () { isRadioPlaying = true; updateRadioUI('Now Playing'); })
        .catch(function () { loadAndPlayRadio(currentStationIndex); });
    }
  }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function setupRadioPlayer() {
    var addRow = $('radio-add-row'), urlIn = $('radio-url-input'), titleIn = $('radio-title-input');
    loadCustomStations();
    renderRadioList();
    on('stationSelect', 'change', function (e) { e.stopPropagation(); loadAndPlayRadio(Number(e.target.value)); });
    radioAudio.addEventListener('playing', function () { isRadioPlaying = true; updateRadioUI('Now Playing'); });
    radioAudio.addEventListener('waiting', function () { updateRadioUI('Loading...'); });
    radioAudio.addEventListener('pause', function () { if (isRadioPlaying) { isRadioPlaying = false; updateRadioUI('Paused'); } });
    radioAudio.addEventListener('error', function () { isRadioPlaying = false; updateRadioUI('Stream Error / Offline'); });
    on('btn-radio-play', 'click', function (e) { e.stopPropagation(); toggleRadioPlayback(); });
    on('btn-radio-prev', 'click', function (e) { e.stopPropagation(); loadAndPlayRadio(currentStationIndex - 1); });
    on('btn-radio-next', 'click', function (e) { e.stopPropagation(); loadAndPlayRadio(currentStationIndex + 1); });
    on('radio-volume', 'input', function (e) {
      var v = clamp(Number(e.target.value), 0, 100);
      radioAudio.volume = v / 100;
      setText('radio-volume-label', v + '%');
      if (v > 0 && radioAudio.muted) { radioAudio.muted = false; setText('btn-radio-mute', '🔊'); }
    });
    on('btn-radio-mute', 'click', function (e) {
      e.stopPropagation();
      radioAudio.muted = !radioAudio.muted;
      setText('btn-radio-mute', radioAudio.muted ? '🔇' : '🔊');
    });
    on('btn-radio-add-toggle', 'click', function (e) { e.stopPropagation(); addRow?.classList.toggle('hide'); urlIn?.focus(); });
    var addFromInputs = function () {
      if (addCustomStation(urlIn?.value || '', titleIn?.value || '')) {
        if (urlIn) urlIn.value = '';
        if (titleIn) titleIn.value = '';
        addRow?.classList.add('hide');
      }
    };
    on('btn-radio-add', 'click', function (e) { e.stopPropagation(); addFromInputs(); });
    [urlIn, titleIn].forEach(function (el) {
      el?.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addFromInputs(); } });
    });
    on('btn-radio-clear', 'click', function (e) {
      e.stopPropagation();
      if (!customStations.length) return;
      var wasCustom = currentStationIndex >= defaultStations.length;
      customStations = [];
      saveCustomStations();
      rebuildStations();
      if (wasCustom) { currentStationIndex = 0; if (isRadioPlaying) { loadAndPlayRadio(0); return; } }
      updateRadioUI();
    });
    updateRadioUI('Stopped');
  }
  function setupAudioTabs() {
    function switchTab(t) {
      var r = t === 'radio';
      $('tabBtnRadio')?.classList.toggle('active', r);
      $('tabBtnYoutube')?.classList.toggle('active', !r);
      $('tabContentRadio')?.classList.toggle('active', r);
      $('tabContentYoutube')?.classList.toggle('active', !r);
    }
    on('tabBtnRadio', 'click', function (e) { e.stopPropagation(); switchTab('radio'); });
    on('tabBtnYoutube', 'click', function (e) { e.stopPropagation(); switchTab('youtube'); });
  }
  function setupMiniAudioPill() {
    var yt = function () { return activeAudioSource === 'youtube'; };
    on('btn-mini-prev', 'click', function (e) { e.stopPropagation(); yt() ? playPrevMusic() : loadAndPlayRadio(currentStationIndex - 1); });
    on('btn-mini-play', 'click', function (e) { e.stopPropagation(); yt() ? toggleMusicPlayback() : toggleRadioPlayback(); });
    on('btn-mini-next', 'click', function (e) { e.stopPropagation(); yt() ? playNextMusic(true) : loadAndPlayRadio(currentStationIndex + 1); });
    on('btn-mini-open', 'click', function (e) {
      e.stopPropagation();
      menu.classList.add('open');
      $(yt() ? 'tabBtnYoutube' : 'tabBtnRadio')?.click();
      updateMiniPill();
    });
    on('btn-mini-close', 'click', function (e) { e.stopPropagation(); miniPillDismissed = true; updateMiniPill(); });
  }

  /* ================= GIGI / BIJI WIJEN (HEALTH) ================= */
  var TEETH_PER_ROW = 10;
  var teeth = []; // index 0-9 atas, 10-19 bawah
  // Urutan rontok acak tetap (satu per satu)
  var LOSS_ORDER = [3, 14, 7, 18, 0, 11, 5, 16, 9, 2, 13, 6, 19, 1, 12, 8, 17, 4, 15, 10];

  (function buildTeeth() {
    var rows = [$('teethTop'), $('teethBottom')];
    rows.forEach(function (row) {
      if (!row) return;
      for (var i = 0; i < TEETH_PER_ROW; i++) {
        var t = document.createElement('i');
        t.className = 'tooth';
        row.appendChild(t);
        teeth.push(t);
      }
    });
  })();

  function toothCountForHealth(h) {
    var total = TEETH_PER_ROW * 2;
    if (h >= 80) return total;                                   // utuh
    if (h >= 40) return total - Math.round((80 - h) / 40 * 10);  // 20 -> 10
    return Math.max(1, Math.round(h / 40 * 10));                 // sisa sedikit (ompong)
  }

  /* ================= LIDAH KEJU MELEHEH (RPM) ================= */
  var cheesePath = $('cheesePath');
  var cheeseRpm = 0;
  var cheesePhase = 0;

  function drawCheese() {
    var target = S.rpm, nowT = performance.now();
    if (bootUntil > nowT) target = Math.sin((1 - (bootUntil - nowT) / 900) * Math.PI) * MAX_RPM; // boot sweep
    cheeseRpm += (target - cheeseRpm) * 0.14;
    var n = clamp(cheeseRpm / MAX_RPM, 0, 1);
    cheesePhase += 0.04 + n * 0.22;

    var level = 62 - n * 44;          // makin tinggi RPM, keju makin naik
    var amp = 1.5 + n * 6;            // gelombang makin dinamis
    var d = 'M0 70 L0 ' + level.toFixed(1);
    for (var x = 0; x <= 300; x += 10) {
      var wave = Math.sin((x / 300) * Math.PI * 4 + cheesePhase) * amp;
      var drip1 = Math.exp(-Math.pow((x - 240) / 14, 2)) * (8 + n * 10);
      var drip2 = Math.exp(-Math.pow((x - 70) / 11, 2)) * (5 + n * 8);
      var y = Math.min(68, level + wave + drip1 + drip2);
      d += ' L' + x + ' ' + y.toFixed(1);
    }
    d += ' L300 70 Z';
    if (cheesePath) cheesePath.setAttribute('d', d);
    requestAnimationFrame(drawCheese);
  }

  /* ================= RENDER ================= */
  function renderRPM() {
    var n = clamp(S.rpm, 0, MAX_RPM) / MAX_RPM;
    cockpit.classList.toggle('redline', n > REDLINE);
  }

  function renderSpeed() {
    setText('speedValue', String(Math.round(S.speed)).padStart(3, '0'));
    setText('speedUnit', S.speedMode === 1 ? 'MPH' : (S.speedMode === 2 ? 'KNOTS' : 'KM/H'));

    // Panik di 60 ke atas (sesuai angka yang tampil)
    cockpit.classList.toggle('overspeed', S.speed >= SPEED_LIMIT);
  }

  function renderGear() {
    setText('gearValue', S.gear);
  }

  function renderHeadlights() {
    var el = $('headlightIndicator');
    if (el) {
      el.className = 'vehicle-indicator' + (S.lights === 1 ? ' active low-beam' : (S.lights === 2 ? ' active high-beam' : ''));
      el.title = 'Headlights: ' + (S.lights === 1 ? 'Low Beam' : (S.lights === 2 ? 'High Beam' : 'Off'));
    }
    setText('headlightLabel', S.lights === 2 ? 'HIGH' : (S.lights === 1 ? 'LOW' : 'LIGHT'));
    cockpit.classList.toggle('night-mode', S.lights !== 0);
  }

  function renderIndicators() {
    $('leftIndicator').classList.toggle('active', S.left);
    $('rightIndicator').classList.toggle('active', S.right);
    cockpit.classList.toggle('hazard-active', S.left && S.right);
    // Mata melirik mengikuti sein (hazard = lurus)
    cockpit.classList.toggle('look-left', S.left && !S.right);
    cockpit.classList.toggle('look-right', S.right && !S.left);
  }

  function renderOdometer() {
    setText('odometerValue', Math.max(0, S.odo).toFixed(1).padStart(8, '0'));
    setText('odoUnit', S.speedMode === 0 ? 'KM' : 'MI');
  }

  function updateEngineIconState() {
    var icon = $('engineCheck');
    if (!icon) return;
    var cls = 'vehicle-indicator';
    if (S.engine) cls += S.health <= 20 ? ' active danger' : (S.health < 50 ? ' active warn' : ' active');
    icon.className = cls;
  }

  function renderEngine() {
    if (!prevEngine && S.engine) bootUntil = performance.now() + 900;
    prevEngine = S.engine;
    cockpit.classList.toggle('engine-off', !S.engine);
    updateEngineIconState();
    updateBeltBeep();
  }

  function renderDoorLock() {
    var icon = $('doorLockIcon'), shackle = $('lockShackle');
    if (!icon || !shackle) return;
    icon.classList.toggle('locked', S.locked);
    icon.classList.toggle('unlocked', !S.locked);
    icon.title = S.locked ? 'Doors: Locked' : 'Doors: Unlocked';
    shackle.setAttribute('d', S.locked ? 'M7 11V7a5 5 0 0 1 10 0v4' : 'M7 11V7a5 5 0 0 1 9.9-1');
    if (prevLocked !== null && prevLocked !== S.locked) {
      icon.classList.remove('lock-snap');
      void icon.offsetWidth;
      icon.classList.add('lock-snap');
      clearTimeout(lockSnapTimer);
      lockSnapTimer = setTimeout(function () { icon.classList.remove('lock-snap'); }, 360);
    }
    prevLocked = S.locked;
  }

  function renderSeatbelt() {
    var iconBelt = $('seatbeltIndicator');
    if (iconBelt) {
      iconBelt.className = 'vehicle-indicator' + (!S.belt ? ' active danger unbuckled' : ' buckled');
      iconBelt.title = S.belt ? 'Seatbelt: Buckled' : 'Seatbelt: Unbuckled';
    }
    cockpit.classList.toggle('belt-unfastened', !S.belt);
  }

  function renderFuel() {
    var fuelClamped = clamp(S.fuel, 0, 100);
    setText('fuelValue', Math.round(fuelClamped) + '%');
    var bar = $('fuelBar');
    if (bar) {
      bar.style.width = fuelClamped + '%';
      bar.classList.toggle('critical', fuelClamped <= 20);
    }
    cockpit.classList.toggle('fuel-critical', fuelClamped <= 20);
  }

  function renderHealth() {
    var h = clamp(S.health, 0, 100);
    if (prevHealth - h >= 2) {
      cockpit.classList.remove('impact-flash');
      void cockpit.offsetWidth;
      cockpit.classList.add('impact-flash');
      clearTimeout(impactTimer);
      impactTimer = setTimeout(function () { cockpit.classList.remove('impact-flash'); }, 500);
    }
    prevHealth = h;
    setText('healthValue', Math.round(h) + '%');

    var keep = toothCountForHealth(h);
    var lostFrom = {};
    LOSS_ORDER.forEach(function (toothIdx, pos) { lostFrom[toothIdx] = pos >= keep; });
    teeth.forEach(function (t, i) { t.classList.toggle('lost', !!lostFrom[i]); });

    $('mouth').classList.toggle('sparkle', h >= 80);        // 100-80%: berkilau
    cockpit.classList.toggle('hurt', h < 80);               // plester + noda saus
    cockpit.classList.toggle('weak', h < 20);               // mulut gemetar lemas
    cockpit.classList.toggle('health-critical', h <= 15);
    cockpit.classList.toggle('health-low', h <= 20);
    updateEngineIconState();
  }

  function render() {
    renderSpeed();
    renderRPM();
    renderGear();
    renderHeadlights();
    renderIndicators();
    renderOdometer();
    renderEngine();
    renderSeatbelt();
    renderDoorLock();
    renderFuel();
    renderHealth();
  }

  /* ================= HOOKS SERVER ================= */
  window.setEngine = function (engineState) {
    S.engine = Boolean(engineState);
    if (elements.engine) elements.engine.innerText = onOrOff(engineState);
    renderEngine();
  };

  window.setSpeed = function (speedMS) {
    var s = Number(speedMS);
    if (isNaN(s)) s = 0;
    S.speedMS = s;
    S.kmh = s * 3.6;
    switch (S.speedMode) {
      case 1: S.speed = Math.round(s * 2.236936); break; // MPH
      case 2: S.speed = Math.round(s * 1.943844); break; // Knots
      default: S.speed = Math.round(s * 3.6); break;      // KMH
    }
    if (elements.speed) {
      elements.speed.innerText = S.speed + ' ' + (S.speedMode === 1 ? 'MPH' : 'KMH');
    }
    renderSpeed();
  };

  window.setRPM = function (rpmVal) {
    var v = num(rpmVal);
    S.rpm = v <= 1.5 ? v * MAX_RPM : v;
    if (elements.rpm) elements.rpm.innerText = (S.rpm / MAX_RPM).toFixed(4) + ' RPM';
    renderRPM();
  };

  window.setFuel = function (fuelVal) {
    var v = num(fuelVal);
    S.fuel = v <= 1 ? v * 100 : v;
    if (elements.fuel) elements.fuel.innerText = S.fuel.toFixed(1) + '%';
    renderFuel();
  };

  window.setHealth = function (healthVal) {
    var v = num(healthVal);
    S.health = v <= 1 ? v * 100 : (v > 100 ? v / 10 : v);
    if (elements.health) elements.health.innerText = S.health.toFixed(1) + '%';
    renderHealth();
  };

  window.setGear = function (gearVal) {
    S.gear = (gearVal === 0 || gearVal === '0') ? 'N' : String(gearVal).toUpperCase();
    if (elements.gear) elements.gear.innerText = String(gearVal);
    renderGear();
  };

  window.setHeadlights = function (lightState) {
    S.lights = num(lightState);
    if (elements.headlights) {
      elements.headlights.innerText = S.lights === 1 ? 'On' : (S.lights === 2 ? 'High Beam' : 'Off');
    }
    renderHeadlights();
  };

  window.setLeftIndicator = function (indicatorState) {
    S.left = Boolean(indicatorState);
    if (elements.indicators) {
      elements.indicators.innerText = (S.left ? 'On' : 'Off') + ' / ' + (S.right ? 'On' : 'Off');
    }
    renderIndicators();
  };

  window.setRightIndicator = function (indicatorState) {
    S.right = Boolean(indicatorState);
    if (elements.indicators) {
      elements.indicators.innerText = (S.left ? 'On' : 'Off') + ' / ' + (S.right ? 'On' : 'Off');
    }
    renderIndicators();
  };

  window.setSeatbelts = function (seatbeltState) {
    S.belt = Boolean(seatbeltState);
    if (elements.seatbelts) elements.seatbelts.innerText = onOrOff(seatbeltState);
    renderSeatbelt();
    updateBeltBeep();
  };

  function setDoorLock(state) {
    if (typeof state === 'string') {
      var n = state.trim().toLowerCase();
      S.locked = n === 'true' || n === '1' || n === 'locked' || n === 'lock';
    } else if (typeof state === 'number') {
      S.locked = state >= 1;
    } else {
      S.locked = Boolean(state);
    }
    renderDoorLock();
  }
  window.setDoorLock = setDoorLock;
  window.setLocked = setDoorLock;
  window.setVehicleLock = setDoorLock;
  window.setDoorsLocked = setDoorLock;

  window.setSpeedMode = function (modeVal) {
    var m = String(modeVal).toLowerCase();
    if (m === 'mph' || m === '1') S.speedMode = 1;
    else if (m === 'knots' || m === 'knot' || m === '2') S.speedMode = 2;
    else S.speedMode = 0;
    window.setSpeed(S.speedMS);
    renderOdometer();
  };

  window.setOdometer = function (dist) {
    S.odo = num(dist);
    if (elements.odometer) elements.odometer.innerText = S.odo.toFixed(1) + ' Miles';
    renderOdometer();
  };

  /* ================= PENGATURAN HUD & LAYOUT ================= */
  function applyLayout() {
    cockpit.style.setProperty('--tx', L.tx + 'px');
    cockpit.style.setProperty('--ty', L.ty + 'px');
    cockpit.style.setProperty('--scale', L.scale);
    THEMES.forEach(function (t) { cockpit.classList.remove(t); });
    cockpit.classList.add(THEMES[L.theme] || THEMES[0]);
  }

  function clampLayout() {
    L.scale = clamp(L.scale, 0.5, 2);
    applyLayout();
    var r = cockpit.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    if (r.left < 0) L.tx += -r.left;
    if (r.right > vw) L.tx -= (r.right - vw);
    if (r.top < 0) L.ty += -r.top;
    if (r.bottom > vh) L.ty -= (r.bottom - vh);
    applyLayout();
  }

  function saveLayout() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(L)); } catch (e) {}
  }

  function loadLayout() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      L.tx = num(o.tx); L.ty = num(o.ty);
      L.scale = clamp(num(o.scale, 1), 0.5, 2);
      L.theme = clamp(parseInt(o.theme, 10) || 0, 0, THEMES.length - 1);
    } catch (e) {}
  }

  var HINTS = {
    none: 'Pilih mode · klik kanan untuk menutup menu',
    move: 'Mode PINDAH: tahan & geser mouse untuk memindahkan HUD',
    resize: 'Mode RESIZE: geser mouse atau scroll untuk ubah ukuran',
    reset: 'Posisi & ukuran dikembalikan ke default',
    theme: 'Tema burger diganti'
  };

  function setMode(m, hintKey) {
    mode = m;
    cockpit.classList.toggle('mode-move', m === 'move');
    cockpit.classList.toggle('mode-resize', m === 'resize');
    var btns = menu.querySelectorAll('.menu-btns button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-act') === m);
    }
    hint.textContent = HINTS[hintKey || m || 'none'];
  }

  menu.addEventListener('click', function (e) {
    var b = e.target.closest('.menu-btns button');
    if (!b || e.button !== 0) return;
    var act = b.getAttribute('data-act');
    if (act === 'move' || act === 'resize') {
      setMode(mode === act ? null : act);
    } else if (act === 'reset') {
      L.tx = 0; L.ty = 0; L.scale = 1;
      setMode(null, 'reset');
      clampLayout(); saveLayout();
    } else if (act === 'theme') {
      L.theme = (L.theme + 1) % THEMES.length;
      applyLayout(); saveLayout();
      hint.textContent = 'Tema: ' + THEME_NAMES[L.theme];
    }
  });

  if (closeSettings) {
    closeSettings.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.remove('open');
      setMode(null);
      updateMiniPill();
    });
  }

  cockpit.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var open = !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    if (!open) setMode(null);
    else setMode(mode);
    updateMiniPill();
  });

  var drag = null;

  cockpit.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !mode) return;
    if (e.target.closest('#settingsMenu') || e.target.closest('#mini-music-pill')) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, tx: L.tx, ty: L.ty, scale: L.scale };
  });

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (mode === 'move') {
      L.tx = drag.tx + dx;
      L.ty = drag.ty + dy;
    } else if (mode === 'resize') {
      L.scale = drag.scale - dy / 220;
    }
    clampLayout();
  });

  window.addEventListener('mouseup', function () {
    if (!drag) return;
    drag = null;
    saveLayout();
  });

  window.addEventListener('wheel', function (e) {
    if (mode !== 'resize' || !menu.classList.contains('open')) return;
    e.preventDefault();
    L.scale += (e.deltaY < 0 ? 0.05 : -0.05);
    clampLayout(); saveLayout();
  }, { passive: false });

  window.addEventListener('resize', function () { clampLayout(); });

  /* ================= INIT ================= */
  loadLayout();
  clampLayout();
  setMode(null);
  setupAudioTabs();
  setupRadioPlayer();
  setupMiniAudioPill();
  setupMusicPlayer();
  requestAnimationFrame(drawCheese);

  window.setEngine(false);
  window.setSpeedMode('kmh');
  window.setSpeed(0);
  window.setRPM(0);
  window.setFuel(100);
  window.setHealth(100);
  window.setGear('N');
  window.setHeadlights(0);
  window.setLeftIndicator(false);
  window.setRightIndicator(false);
  window.setSeatbelts(false);
  window.setDoorLock(false);
  window.setOdometer(0);

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    var payload = d.data && typeof d.data === 'object' ? d.data : d;

    var aliases = {
      engine: 'setEngine',
      speed: 'setSpeed',
      rpm: 'setRPM',
      fuel: 'setFuel',
      health: 'setHealth',
      gear: 'setGear',
      headlights: 'setHeadlights',
      leftIndicator: 'setLeftIndicator',
      rightIndicator: 'setRightIndicator',
      seatbelts: 'setSeatbelts',
      seatbelt: 'setSeatbelts',
      locked: 'setDoorLock',
      doorLock: 'setDoorLock',
      doorsLocked: 'setDoorLock',
      vehicleLock: 'setDoorLock',
      speedMode: 'setSpeedMode',
      odometer: 'setOdometer'
    };

    for (var key in aliases) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        var fn = window[aliases[key]];
        if (typeof fn === 'function') fn(payload[key]);
      }
    }
  });
})();