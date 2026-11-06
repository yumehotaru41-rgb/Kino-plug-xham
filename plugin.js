// Xhamster — plugin de Kino
// Autor: Hotaru Yume (hotaruyume)
// Busca y reproduce videos de xhamster.com en Kino (teléfono y TV).
// Contenido 18+: todos los ítems se marcan con adult: true y Kino los
// muestra solo con el código 18+ desbloqueado (apiVersion 6).

const BASE = "https://xhamster.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HLS_MIME = "application/x-mpegurl";

// ---------- red ----------

async function get(url) {
  const r = await kino.fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": (kino.lang || "").indexOf("en") === 0 ? "en-US,en;q=0.8" : "es-419,es;q=0.8,en;q=0.6"
    },
    timeoutMs: 20000
  });
  if (r.status === 404) {
    throw kino.error("not_found", "HTTP 404 " + url, { userMessage: "Ese video ya no está en xHamster." });
  }
  if (!r.ok) {
    throw kino.error("unavailable", "HTTP " + r.status + " " + url, { userMessage: "xHamster no respondió. Revisa tu conexión y vuelve a intentarlo." });
  }
  return r.text();
}

// ---------- window.initials ----------

function parseInitials(html) {
  const m = html.match(/window\.initials\s*=\s*(\{[\s\S]+?\})\s*;\s*<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

function thumbProps(data) {
  if (!data) return [];
  const sr = data.searchResult;
  if (sr && Array.isArray(sr.videoThumbProps)) return sr.videoThumbProps;
  const lp = data.layoutPage;
  if (lp && lp.videoListProps && Array.isArray(lp.videoListProps.videoThumbProps)) {
    return lp.videoListProps.videoThumbProps;
  }
  return [];
}

// ---------- texto ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/", "#47": "/" };

function unescape(s) {
  return String(s)
    .replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, function (all, name) {
      if (ENTITIES[name]) return ENTITIES[name];
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        if (code > 0 && code < 0x10ffff) return String.fromCodePoint(code);
      }
      return all;
    });
}

function clip(s, n) {
  s = String(s || "").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function durBadge(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = function (x) { return x < 10 ? "0" + x : String(x); };
  return h > 0 ? h + ":" + p(m) + ":" + p(s) : m + ":" + p(s);
}

// ---------- ítems ----------

// Un video publicitario o de pago nunca es reproducible gratis: se descarta
// por sus marcas y por su URL, y se exige duración y ficha de video real.
function isPlayableEntry(e) {
  if (!e || typeof e !== "object") return false;
  const url = e.pageURL || "";
  if (url.indexOf("/videos/") === -1) return false;
  if (url.indexOf("/premium") !== -1) return false;
  if (e.isPremium === true || e.premium === true) return false;
  if (e.isPaid === true || e.paid === true || e.requiredPremium === true) return false;
  if (e.isFH === true || e.exclusive === true) return false;
  const d = Number(e.duration) || 0;
  if (d <= 0) return false;
  return true;
}

function toItem(e) {
  if (!isPlayableEntry(e)) return null;
  const url = e.pageURL;
  const m = url.match(/-([0-9A-Za-z]+)(?:\?.*)?$/);
  if (!m) return null;
  const img = e.imageURL || e.thumbURL || "";
  const item = {
    id: m[1],
    ref: "v|" + url,
    title: clip(unescape(e.title || "Video de xHamster"), 200),
    kind: "movie",
    adult: true
  };
  if (img) item.backdrop = img; // miniatura horizontal 16:9
  const d = Number(e.duration) || 0;
  if (d > 0) {
    item.runtimeMinutes = Math.max(1, Math.round(d / 60));
    item.badges = [durBadge(d)];
  }
  const v = Number(e.views) || 0;
  if (v > 0) item.overview = v.toLocaleString("es") + " reproducciones en xHamster";
  return item;
}

// ---------- listados ----------

const ROWS = [
  { id: "top",     title: "Recomendados",     path: "/" },
  { id: "newest",  title: "Novedades",        path: "/newest" },
  { id: "views",   title: "Más vistos",       path: "/most-viewed" },
  { id: "best",    title: "Mejor valorados",   path: "/best" },
  { id: "milf",    title: "MILF",             search: "milf" },
  { id: "amateur", title: "Amateur",          search: "amateur" },
  { id: "gay",     title: "Gay",              path: "/gay" },
  { id: "trans",   title: "Trans",            path: "/shemale" }
];

function rowUrl(cfg, page) {
  if (cfg.search) {
    return BASE + "/search/" + encodeURIComponent(cfg.search) + "?page=" + page;
  }
  const sep = cfg.path.indexOf("?") === -1 ? "?" : "&";
  return BASE + cfg.path + sep + "page=" + page;
}

// Trae páginas del listado hasta llenar want ítems o gastar maxPages.
async function listPage(cfg, page) {
  const html = await get(rowUrl(cfg, page));
  const data = parseInitials(html);
  if (!data) {
    throw kino.error("unavailable", "sin window.initials", { userMessage: "xHamster cambió su página; no se pudo leer el listado." });
  }
  return thumbProps(data).map(toItem).filter(Boolean);
}

async function collect(cfg, startPage, want, maxPages) {
  const items = [];
  const seen = {};
  let last = startPage - 1;
  for (let p = startPage; p < startPage + maxPages && items.length < want; p++) {
    const got = await listPage(cfg, p);
    last = p;
    for (let i = 0; i < got.length; i++) {
      if (seen[got[i].id]) continue;
      seen[got[i].id] = true;
      items.push(got[i]);
      if (items.length >= want) break;
    }
  }
  return { items: items, last: last };
}

function findRow(ref) {
  const m = String(ref || "").match(/^row:([a-z0-9-]+)$/);
  if (!m) return null;
  for (let i = 0; i < ROWS.length; i++) if (ROWS[i].id === m[1]) return ROWS[i];
  return null;
}

// ---------- descifrado de enlaces (xplayer) ----------

function stepBytes(id, st) {
  let s = st.s;
  if (id === 1) {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    st.s = s;
    return s & 0xff;
  }
  if (id === 2) {
    s = (s ^ (s << 13)) | 0;
    s = (s ^ (s >>> 17)) | 0;
    s = (s ^ (s << 5)) | 0;
    st.s = s;
    return s & 0xff;
  }
  if (id === 3) {
    s = (s + 0x9e3779b9) | 0;
    s = (s ^ (s >>> 16)) | 0;
    s = Math.imul(s, 0x85ebca77) | 0;
    s = (s ^ (s >>> 13)) | 0;
    s = Math.imul(s, 0xc2b2ae3d) | 0;
    s = (s ^ (s >>> 16)) | 0;
    st.s = s;
    return s & 0xff;
  }
  if (id === 4) {
    s = (s + 0x6d2b79f5) | 0;
    s = ((s << 7) | (s >>> 25)) | 0;
    s = (s + 0x9e3779b9) | 0;
    s = (s ^ (s >>> 11)) | 0;
    s = Math.imul(s, 0x27d4eb2d) | 0;
    st.s = s;
    return s & 0xff;
  }
  if (id === 5) {
    s = (s ^ (s << 7)) | 0;
    s = (s ^ (s >>> 9)) | 0;
    s = (s ^ (s << 8)) | 0;
    s = (s + 0xa5a5a5a5) | 0;
    st.s = s;
    return s & 0xff;
  }
  if (id === 6) {
    s = (Math.imul(s, 0x2c9277b5) + 0xac564b05) | 0;
    const s2 = (s ^ (s >>> 18)) | 0;
    const shift = (s >>> 27) & 31;
    st.s = s;
    return (s2 >>> shift) & 0xff;
  }
  if (id === 7) {
    s = (s + 0x9e3779b9) | 0;
    let e = (s ^ (s << 5)) | 0;
    e = Math.imul(e, 0x7feb352d) | 0;
    e = (e ^ (e >>> 15)) | 0;
    e = Math.imul(e, 0x846ca68b) | 0;
    st.s = s;
    return e & 0xff;
  }
  return null;
}

function decipherHex(hex) {
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  if (bytes.length < 6) return null;
  const id = bytes[0];
  if (id < 1 || id > 7) return null;
  const seed = (bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24)) | 0;
  const st = { s: seed };
  let out = "";
  for (let i = 5; i < bytes.length; i++) {
    const k = stepBytes(id, st);
    if (k === null) return null;
    out += String.fromCharCode(bytes[i] ^ k);
  }
  return out;
}

function decipherUrl(u) {
  if (!u || typeof u !== "string") return null;
  if (/^[0-9a-fA-F]{12,}$/.test(u)) return decipherHex(u);
  const m = u.match(/^(https?:\/\/[^\/]+)\/([0-9a-fA-F]{12,})([\/,][^\?#]*)(\?[^#]*)?(#.*)?$/);
  if (!m) return null;
  const dec = decipherHex(m[2]);
  if (!dec) return null;
  return m[1] + "/" + dec + m[3] + (m[4] || "") + (m[5] || "");
}

function heightOf(q) {
  const m = String(q || "").match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) : 0;
}

// ---------- capacidades ----------

export async function search(arg) {
  const q = String((arg && arg.q) || "").trim();
  if (!q) return [];
  const cfg = { search: q.replace(/\s+/g, " ") };
  const out = await collect(cfg, 1, 100, 3); // máximo permitido: 100
  if (out.items.length === 0) {
    return [];
  }
  return { items: out.items, next: String(out.last + 1) };
}

export async function home() {
  const rows = [];
  for (let i = 0; i < ROWS.length; i++) {
    const cfg = ROWS[i];
    try {
      const out = await collect(cfg, 1, 60, 2); // máximo permitido: 60 por fila
      if (out.items.length > 0) {
        rows.push({ id: cfg.id, title: cfg.title, ref: "row:" + cfg.id, genre: "otros", items: out.items });
      }
    } catch (e) {
      // una fila que falla no tumba las demás
    }
  }
  return rows;
}

export async function browse(ref, cursor) {
  await Promise.resolve();
  const cfg = findRow(ref);
  if (!cfg) {
    throw kino.error("not_found", "fila desconocida: " + ref, { userMessage: "Esa sección de xHamster no existe." });
  }
  const start = cursor ? Math.max(1, parseInt(cursor, 10) || 1) : 1;
  const out = await collect(cfg, start, 100, 3); // máximo permitido: 100 por página
  return { items: out.items, next: String(out.last + 1) };
}

export async function resolve(ref) {
  await Promise.resolve();
  const m = String(ref || "").match(/^v\|(.+)$/);
  if (!m) {
    throw kino.error("not_found", "ref inválida", { userMessage: "Ese video no se puede abrir desde aquí." });
  }
  const pageUrl = m[1];
  const html = await get(pageUrl);
  if (/<div[^>]+id=["']videoClosed["']/i.test(html)) {
    throw kino.error("not_found", "video cerrado", { userMessage: "Este video fue retirado de xHamster." });
  }
  const data = parseInitials(html);
  if (!data || !data.videoModel) {
    throw kino.error("not_found", "sin videoModel", { userMessage: "No se pudo leer la página del video en xHamster." });
  }
  const model = data.videoModel;
  const xp = (data.xplayerSettings && data.xplayerSettings.sources) || {};

  const headers = { "Referer": pageUrl, "User-Agent": UA };
  const mp4s = [];

  // HLS cifrado del reproductor (la mejor opción: se adapta al ancho de banda)
  let hls = null;
  const hs = xp.hls;
  if (hs && typeof hs === "object") {
    const a = decipherUrl(hs.url);
    const b = decipherUrl(hs.fallback);
    if (a || b) {
      hls = { url: a || b, mime: HLS_MIME, label: "HLS (auto)" };
      // la otra copia, si difiere, va como alternativa
      if (a && b && a !== b) {
        mp4s.push({ url: b, mime: HLS_MIME, label: "HLS alterno", height: 9999 });
      }
    }
  }

  // MP4 del reproductor (cifrados), ordenados de mayor a menor calidad
  const std = xp.standard;
  if (std && typeof std === "object") {
    Object.keys(std).forEach(function (key) {
      const list = std[key];
      if (!Array.isArray(list)) return;
      list.forEach(function (f) {
        if (!f || typeof f !== "object") return;
        ["url", "fallback"].forEach(function (k) {
          const u = decipherUrl(f[k]);
          if (!u) return;
          const h = heightOf(f.quality || f.label);
          const mime = u.slice(-5).indexOf(".m3u8") !== -1 ? HLS_MIME : "video/mp4";
          const label = (mime === HLS_MIME ? "HLS" : "MP4") + " " + (f.label || f.quality || "");
          mp4s.push({ url: u, mime: mime, label: label, height: h });
        });
      });
    });
  }

  // MP4 directos del modelo (sin cifrar), como respaldo
  const src = model.sources;
  if (src && typeof src === "object") {
    Object.keys(src).forEach(function (kind) {
      if (kind === "download") return;
      const q = src[kind];
      if (!q || typeof q !== "object") return;
      Object.keys(q).forEach(function (quality) {
        const u = q[quality];
        if (typeof u === "string" && /^https:\/\//.test(u)) {
          mp4s.push({ url: u, mime: "video/mp4", label: "MP4 " + quality, height: heightOf(quality) });
        }
      });
    });
  }

  mp4s.sort(function (a, b) { return b.height - a.height; });

  // quita duplicados y promos que no sean archivo/playlist
  const seen = {};
  const alts = [];
  for (let i = 0; i < mp4s.length && alts.length < 7; i++) {
    const a = mp4s[i];
    if (seen[a.url]) continue;
    if (!/\.(mp4|m3u8|ts)([\/?#]|$)/i.test(a.url) && a.mime !== HLS_MIME) continue;
    seen[a.url] = true;
    alts.push({ url: a.url, mime: a.mime, label: a.label.slice(0, 48), headers: headers });
  }

  const primary = hls || (alts.length > 0 ? alts.shift() : null);
  if (!primary) {
    throw kino.error("not_found", "sin enlaces", { userMessage: "No se encontró un enlace reproducible (puede ser un video premium o privado)." });
  }

  const stream = {
    url: primary.url,
    mime: primary.mime || HLS_MIME,
    headers: headers,
    label: "Mejor servidor (" + (primary.label || "auto") + ")"
  };
  if (alts.length > 0) stream.alternatives = alts.slice(0, 7);
  const d = Number(model.duration) || 0;
  if (d > 0) stream.durationMs = d * 1000;
  return stream;
}
