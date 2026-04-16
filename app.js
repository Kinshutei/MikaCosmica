// ── データソース ──────────────────────────────────────────────────────────────
const STREAMING_URL        = 'streaminginfo_Mikage.json'
const MASTER_URL           = 'rkmusic_song_master.json'
const MASTER_FALLBACK_URL  = 'https://raw.githubusercontent.com/Kinshutei/MikaCosmica/main/rkmusic_song_master.json'
const DEFAULT_VOLUME  = 50

// ── 状態 ─────────────────────────────────────────────────────────────────────
let ytPlayer       = null
let ytReady        = false
let queue          = []
let queueIdx       = -1
let isPlaying      = false
let randomMode     = false
let allLive        = []
let openGroups     = new Set()
let searchQ        = ''
let trackStart     = 0
let trackEnd       = null
let elapsed        = 0
let currentElapsed = 0
let lastTickMs     = null
let seekTimer      = null

// ── YouTube IFrame API ────────────────────────────────────────────────────────
function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('ytPlayer', {
    height: '1',
    width: '1',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
    },
    events: {
      onReady:       onPlayerReady,
      onStateChange: onPlayerStateChange,
    },
  })
}

function onPlayerReady() {
  ytReady = true
}

function onPlayerStateChange(e) {
  if (e.data === YT.PlayerState.PLAYING) {
    isPlaying = true
    updatePlayBtn()
    if (!seekTimer) { lastTickMs = Date.now(); startSeekTimer() }
  }
  if (e.data === YT.PlayerState.PAUSED) {
    isPlaying = false
    updatePlayBtn()
    stopSeekTimer()
  }
  if (e.data === YT.PlayerState.BUFFERING) {
    stopSeekTimer()
  }
  if (e.data === YT.PlayerState.ENDED) {
    isPlaying = false
    updatePlayBtn()
    stopSeekTimer()
  }
}

// ── シークタイマー ────────────────────────────────────────────────────────────
function startSeekTimer() {
  stopSeekTimer()
  lastTickMs = Date.now()
  seekTimer  = setInterval(tick, 500)
}

function stopSeekTimer() {
  if (seekTimer) { clearInterval(seekTimer); seekTimer = null }
}

function tick() {
  // ytPlayer.getCurrentTime() でドリフト補正
  if (ytPlayer && ytReady) {
    try {
      const ct = ytPlayer.getCurrentTime()
      if (typeof ct === 'number') {
        elapsed    = Math.max(0, ct - trackStart)
        lastTickMs = Date.now()
      } else {
        const now = Date.now()
        elapsed  += (now - lastTickMs) / 1000
        lastTickMs = now
      }
    } catch {
      const now = Date.now()
      elapsed  += (now - lastTickMs) / 1000
      lastTickMs = now
    }
  } else {
    const now = Date.now()
    elapsed  += (now - lastTickMs) / 1000
    lastTickMs = now
  }
  renderSeek()
}

function renderSeek() {
  const duration = trackEnd !== null ? trackEnd - trackStart : 0

  if (trackEnd !== null && elapsed >= duration) {
    elapsed = duration
    stopSeekTimer()
    if (ytPlayer && ytReady) ytPlayer.pauseVideo()
    isPlaying = false
    updatePlayBtn()
    currentElapsed = elapsed
    playNext()
    return
  }

  const pct = duration > 0 ? Math.min(elapsed / duration * 100, 100) : 0
  currentElapsed = elapsed
  document.getElementById('seekProgress').style.width = `${pct}%`
  document.getElementById('seekHandle').style.left    = `${pct}%`
  document.getElementById('timeElapsed').textContent  = formatTime(elapsed)
  if (duration > 0 && document.getElementById('timeTotal').textContent === '–:––') {
    document.getElementById('timeTotal').textContent = formatTime(duration)
  }
}

// ── 再生制御 ──────────────────────────────────────────────────────────────────
function startPlay(videoId, startSec, endSec) {
  trackStart = startSec
  trackEnd   = endSec
  elapsed    = 0
  currentElapsed = 0

  if (!ytPlayer || !ytReady) {
    // API未準備なら少し待って再試行
    setTimeout(() => startPlay(videoId, startSec, endSec), 300)
    return
  }

  ytPlayer.loadVideoById({ videoId, startSeconds: startSec })
  ytPlayer.setVolume(loadVolume(videoId))
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 通常再生用キュー：startIdxからCSV順
function buildNormalQueue(startIdx) {
  return [...allLive.slice(startIdx), ...allLive.slice(0, startIdx)]
}

// ランダム再生用キュー：開始曲のアルバムから始め、アルバム単位でランダム順
function buildRandomQueue(startTrack) {
  const albumMap = {}
  for (const t of allLive) {
    if (!albumMap[t.videoId]) albumMap[t.videoId] = []
    albumMap[t.videoId].push(t)
  }
  const startVideoId = startTrack.videoId
  // 開始アルバム：選択曲を先頭に、残りをシャッフル
  const startAlbum = albumMap[startVideoId]
  const rest = shuffleArray(startAlbum.filter(t => t !== startTrack))
  const startAlbumQueue = [startTrack, ...rest]
  // 他のアルバムをランダム順に並べ、各アルバム内もシャッフル
  const otherVideoIds = shuffleArray(Object.keys(albumMap).filter(v => v !== startVideoId))
  const otherQueues = otherVideoIds.flatMap(vid => shuffleArray([...albumMap[vid]]))
  return [...startAlbumQueue, ...otherQueues]
}

// トラックを切り替えて再生（キューは変更しない）
function setTrack(idx) {
  queueIdx = idx
  const track = queue[queueIdx]
  if (!track) return
  isPlaying = true
  updatePlayBtn()
  updatePlayerUI(track)
  openGroups.add(track.videoId)
  renderList()
  startPlay(track.videoId, track.startSec, track.endSec)
}

// 新しいキューを組んで再生開始
function playFrom(list, idx) {
  const track = list[idx]
  if (!track) return
  const allLiveIdx = allLive.indexOf(track)
  queue = allLiveIdx >= 0 ? buildNormalQueue(allLiveIdx) : list.slice(idx)
  setTrack(0)
}

// ランダム再生開始
function startRandomPlay() {
  if (!allLive.length) return
  const startTrack = allLive[Math.floor(Math.random() * allLive.length)]
  queue = buildRandomQueue(startTrack)
  setTrack(0)
}

function updatePlayerUI(track) {
  let line1 = track.title
  if (track.artist)  line1 += ` / ${track.artist}`
  if (track.release) line1 += ` - ${track.release}`
  document.getElementById('trackTitle').textContent = line1
  document.getElementById('trackFrame').textContent = track.frameName

  // ドット描画（枠内の全トラック）
  const groupTracks = allLive.filter(t => t.videoId === track.videoId)
  const dotPos = groupTracks.findIndex(t => t.startSec === track.startSec)
  const total = groupTracks.length
  const dotCount = Math.min(total, 10)
  const activeDot = total <= 10
    ? dotPos
    : Math.floor(dotPos / (total / 10))
  document.getElementById('trackDots').innerHTML =
    Array.from({ length: dotCount }, (_, i) =>
      `<span class="track-dot${i === activeDot ? ' active' : ''}"></span>`
    ).join('')

  const img = document.getElementById('thumbImg')
  const ph  = document.getElementById('thumbPlaceholder')
  img.classList.remove('visible')
  ph.style.display = ''
  img.src = thumbUrl(track.videoId)
  img.onload  = () => { img.classList.add('visible'); ph.style.display = 'none' }
  img.onerror = () => { img.classList.remove('visible'); ph.style.display = '' }

  const vol = loadVolume(track.videoId)
  if (ytPlayer && ytReady) ytPlayer.setVolume(vol)

  document.getElementById('seekProgress').style.width = '0%'
  document.getElementById('seekHandle').style.left    = '0%'
  document.getElementById('timeElapsed').textContent  = '0:00'
  document.getElementById('timeTotal').textContent    =
    track.endSec !== null ? formatTime(track.endSec - track.startSec) : '–:––'
}

function playNext() {
  if (!queue.length) return
  setTrack((queueIdx + 1) % queue.length)
}

function playPrev() {
  if (!queue.length) return
  if (currentElapsed > 3) {
    if (ytPlayer && ytReady) ytPlayer.seekTo(trackStart, true)
    elapsed        = 0
    lastTickMs     = Date.now()
    currentElapsed = 0
    return
  }
  setTrack((queueIdx - 1 + queue.length) % queue.length)
}

function togglePlay() {
  if (queueIdx < 0) {
    if (queue.length) setTrack(0)
    return
  }
  if (isPlaying) {
    if (ytPlayer && ytReady) ytPlayer.pauseVideo()
    stopSeekTimer()
  } else {
    if (ytPlayer && ytReady) {
      ytPlayer.playVideo()
      lastTickMs = Date.now()
      startSeekTimer()
    }
  }
}

function updatePlayBtn() {
  document.getElementById('playBtn').textContent = isPlaying ? '⏸' : '▶'
}

// ── データ取得 ────────────────────────────────────────────────────────────────
async function loadData() {
  showMsg('読み込み中...')
  try {
    const [streaming, master] = await Promise.all([
      fetch(STREAMING_URL).then(r => r.json()),
      fetch(MASTER_URL).then(r => r.ok ? r.json() : fetch(MASTER_FALLBACK_URL).then(f => f.json())),
    ])

    const masterMap = {}
    for (const row of master) masterMap[row['song_id']] = row
    allLive = streaming
      .filter(row => row['曲終了時間']?.trim())
      .map(row => {
        const m        = masterMap[row['song_id']] || {}
        const startSec = extractStartSec(row['枠URL'])
        const endSec   = parseTimestamp(row['曲終了時間'])
        return {
          title:     m['楽曲名'] || row['song_id'],
          artist:    m['原曲アーティスト'] || '',
          release:   m['リリース日'] || '',
          frameName: row['枠名'] || '',
          date:      row['配信日'],
          videoId:   extractVideoId(row['枠URL']),
          startSec,
          endSec,
        }
      })
      .filter(t => t.videoId && t.endSec !== null && t.endSec > t.startSec)

    queue = allLive
    renderList()
  } catch (err) {
    showMsg(`❌ 読み込み失敗: ${err.message}`)
  }
}

// ── CSV パーサー ──────────────────────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (!lines.length) return []
  lines[0] = lines[0].replace(/^\uFEFF/, '')
  const headers = parseCsvLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const vals = parseCsvLine(lines[i])
    const obj  = {}
    headers.forEach((h, idx) => obj[h] = vals[idx] ?? '')
    rows.push(obj)
  }
  return rows
}

function parseCsvLine(line) {
  const result = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  result.push(cur)
  return result
}

// ── ユーティリティ ────────────────────────────────────────────────────────────
function extractVideoId(url) {
  if (!url) return null
  const m = url.match(/(?:v=|\/live\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

function extractStartSec(url) {
  if (!url) return 0
  const m = url.match(/[?&]t=(\d+)/)
  return m ? parseInt(m[1]) : 0
}

function parseTimestamp(ts) {
  if (!ts?.trim()) return null
  const parts = ts.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2]
  if (parts.length === 2) return parts[0]*60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

function thumbUrl(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── リスト描画 ────────────────────────────────────────────────────────────────
function renderList() {
  const filtered = searchQ
    ? allLive.filter(t => {
        const q = searchQ.toLowerCase()
        return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      })
    : allLive
  renderTrackList(filtered)
}

function renderTrackList(tracks) {
  const el = document.getElementById('listLive')
  if (!tracks.length) {
    el.innerHTML = '<div class="list-msg">トラックがありません</div>'
    return
  }
  const currentTrack = queue[queueIdx]

  // videoId 単位でグループ化（出現順を保持）
  const groupMap = new Map()
  for (const t of tracks) {
    if (!groupMap.has(t.videoId)) groupMap.set(t.videoId, [])
    groupMap.get(t.videoId).push(t)
  }

  let html = ''
  for (const [videoId, groupTracks] of groupMap) {
    const isOpen    = openGroups.has(videoId)
    const frameName = groupTracks[0].frameName
    const trackItems = groupTracks.map(t => {
      const active = currentTrack && t.videoId === currentTrack.videoId && t.startSec === currentTrack.startSec
      const alidx  = allLive.indexOf(t)
      return `<div class="track-item ${active ? 'active' : ''}" data-idx="${alidx}">
          <div class="track-meta">
            <div class="track-name">${esc(t.title)}${t.artist ? ' / ' + esc(t.artist) : ''}${t.release ? ' - ' + esc(t.release) : ''}</div>
          </div>
        </div>`
    }).join('')
    html += `<div class="album-group">
      <div class="album-hdr" data-videoid="${esc(videoId)}">
        <img class="album-thumb" src="${thumbUrl(videoId)}" alt="" onerror="this.style.display='none'">
        <span class="album-name">${esc(frameName)}</span>
        <span class="album-count">${groupTracks.length}曲</span>
        <button class="album-toggle">${isOpen ? 'ー' : '＋'}</button>
      </div>
      <div class="album-body${isOpen ? ' open' : ''}">${trackItems}</div>
    </div>`
  }
  el.innerHTML = html

  el.querySelectorAll('.album-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const hdr     = btn.closest('.album-hdr')
      const videoId = hdr.dataset.videoid
      const body    = hdr.nextElementSibling
      const isOpen  = body.classList.toggle('open')
      if (isOpen) { openGroups.add(videoId);    btn.textContent = 'ー' }
      else        { openGroups.delete(videoId); btn.textContent = '＋' }
    })
  })

  el.querySelectorAll('.track-item').forEach(item => {
    item.addEventListener('click', () => {
      playFrom(allLive, parseInt(item.dataset.idx))
    })
  })
}

function showMsg(msg) {
  document.getElementById('listLive').innerHTML = `<div class="list-msg">${msg}</div>`
}

// ── 音量記憶 ──────────────────────────────────────────────────────────────────
function loadVolume(videoId) {
  return parseInt(localStorage.getItem(`vol_${videoId}`) ?? DEFAULT_VOLUME)
}

function saveVolume(videoId, vol) {
  localStorage.setItem(`vol_${videoId}`, vol)
}

// ── イベントリスナー ──────────────────────────────────────────────────────────
document.getElementById('seekBar').addEventListener('click', e => {
  if (queueIdx < 0) return
  const bar = e.currentTarget.getBoundingClientRect()
  const pct = (e.clientX - bar.left) / bar.width
  const dur = trackEnd !== null ? trackEnd - trackStart : 0
  if (dur > 0 && ytPlayer && ytReady) {
    const targetSec = trackStart + pct * dur
    ytPlayer.seekTo(targetSec, true)
    elapsed    = pct * dur
    lastTickMs = Date.now()
  }
})

document.getElementById('searchInput').addEventListener('input', e => {
  searchQ = e.target.value
  renderList()
})

document.getElementById('playBtn').addEventListener('click', togglePlay)
document.getElementById('nextBtn').addEventListener('click', playNext)
document.getElementById('prevBtn').addEventListener('click', playPrev)
document.getElementById('refreshBtn').addEventListener('click', loadData)

document.getElementById('guideBtn').addEventListener('click', () => {
  document.getElementById('guideOverlay').classList.add('open')
})
document.getElementById('guideClose').addEventListener('click', () => {
  document.getElementById('guideOverlay').classList.remove('open')
})
document.getElementById('guideOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open')
})

let toastTimer = null
function showVolumeToast(vol) {
  const el = document.getElementById('volumeToast')
  el.textContent = `${vol}%`
  el.classList.add('show')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 1500)
}

function adjustVolume(delta) {
  if (queueIdx < 0 || !queue[queueIdx]) return
  const videoId = queue[queueIdx].videoId
  const current = loadVolume(videoId)
  const next    = Math.min(100, Math.max(0, current + delta))
  saveVolume(videoId, next)
  if (ytPlayer && ytReady) ytPlayer.setVolume(next)
  showVolumeToast(next)
}

document.getElementById('volDownBtn').addEventListener('click', () => adjustVolume(-5))
document.getElementById('volUpBtn').addEventListener('click',   () => adjustVolume(5))

document.getElementById('randomBtn').addEventListener('click', () => {
  randomMode = !randomMode
  document.getElementById('randomBtn').classList.toggle('active', randomMode)
  if (randomMode) startRandomPlay()
})

// ── Service Worker 登録 ───────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  })
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SW_UPDATED') window.location.reload()
  })
}

// ── 初期化 ────────────────────────────────────────────────────────────────────
loadData()
