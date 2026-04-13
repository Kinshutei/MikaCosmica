// ── データソース ──────────────────────────────────────────────────────────────
const STREAMING_URL = 'streaminginfo_Mikage.csv'
const MASTER_URL    = 'rkmusic_song_master.csv'

// ── 状態 ─────────────────────────────────────────────────────────────────────
let ytPlayer       = null
let ytReady        = false
let queue          = []
let queueIdx       = -1
let isPlaying      = false
let allLive        = []
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
}

function playFrom(list, idx) {
  queue    = list
  queueIdx = idx
  const track = queue[queueIdx]
  if (!track) return

  isPlaying = true
  updatePlayBtn()
  updatePlayerUI(track)
  renderList()
  startPlay(track.videoId, track.startSec, track.endSec)
}

function updatePlayerUI(track) {
  document.getElementById('trackTitle').textContent  = track.title
  document.getElementById('trackArtist').textContent = track.artist

  const img = document.getElementById('thumbImg')
  const ph  = document.getElementById('thumbPlaceholder')
  img.classList.remove('visible')
  ph.style.display = ''
  img.src = thumbUrl(track.videoId)
  img.onload  = () => { img.classList.add('visible'); ph.style.display = 'none' }
  img.onerror = () => { img.classList.remove('visible'); ph.style.display = '' }

  document.getElementById('seekProgress').style.width = '0%'
  document.getElementById('seekHandle').style.left    = '0%'
  document.getElementById('timeElapsed').textContent  = '0:00'
  document.getElementById('timeTotal').textContent    =
    track.endSec !== null ? formatTime(track.endSec - track.startSec) : '–:––'
}

function playNext() {
  if (!queue.length) return
  playFrom(queue, (queueIdx + 1) % queue.length)
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
  playFrom(queue, (queueIdx - 1 + queue.length) % queue.length)
}

function togglePlay() {
  if (queueIdx < 0) {
    if (queue.length) playFrom(queue, 0)
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
    const [streamingCsv, masterCsv] = await Promise.all([
      fetch(STREAMING_URL).then(r => r.text()),
      fetch(MASTER_URL).then(r => r.text()),
    ])

    const master = parseCsv(masterCsv)
    const masterMap = {}
    for (const row of master) masterMap[row['song_id']] = row

    const streaming = parseCsv(streamingCsv)
    allLive = streaming
      .filter(row => row['曲終了時間']?.trim())
      .map(row => {
        const m        = masterMap[row['song_id']] || {}
        const startSec = extractStartSec(row['枠URL'])
        const endSec   = parseTimestamp(row['曲終了時間'])
        return {
          title:   m['楽曲名'] || row['song_id'],
          artist:  m['原曲アーティスト'] || '',
          date:    row['配信日'],
          videoId: extractVideoId(row['枠URL']),
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
  el.innerHTML = tracks.map((t, i) => {
    const active = queueIdx === i
    return `
      <div class="track-item ${active ? 'active' : ''}" data-idx="${i}">
        <img class="track-thumb" src="${thumbUrl(t.videoId)}" alt=""
             onerror="this.style.display='none'">
        <div class="track-meta">
          <div class="track-name">${esc(t.title)}</div>
          <div class="track-sub">${esc(t.artist)}${t.date ? ' · ' + t.date : ''}</div>
        </div>
      </div>`
  }).join('')

  el.querySelectorAll('.track-item').forEach(item => {
    item.addEventListener('click', () => {
      playFrom(allLive, parseInt(item.dataset.idx))
    })
  })
}

function showMsg(msg) {
  document.getElementById('listLive').innerHTML = `<div class="list-msg">${msg}</div>`
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

document.getElementById('volumeSlider').addEventListener('input', e => {
  const pct = parseInt(e.target.value)
  document.getElementById('volumeLabel').textContent = `${pct}%`
  if (ytPlayer && ytReady) ytPlayer.setVolume(pct)
})

// ── Service Worker 登録 ───────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  })
}

// ── 初期化 ────────────────────────────────────────────────────────────────────
loadData()
