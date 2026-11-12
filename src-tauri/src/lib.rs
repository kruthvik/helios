#[cfg(windows)]
mod mem;
mod viz;
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use librespot_oauth::{OAuthClient, OAuthClientBuilder, OAuthToken};
use tauri::{async_runtime::Mutex, AppHandle, Manager, State};

const REDIRECT_URI: &str = "http://127.0.0.1:8898/callback";
const SCOPES: &[&str] = &[
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
];
const DONE_PAGE: &str = "<!doctype html><html><body style=\"font-family:sans-serif;text-align:center;padding-top:20vh\"><h2>Signed in to Helios</h2><p>You can close this tab.</p></body></html>";

// Async mutex held across refreshes: Spotify rotates refresh tokens, so two parallel refreshes would race.
#[derive(Default)]
struct AppState(Mutex<Option<(OAuthToken, String)>>);

fn refresh_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("refresh_token"))
}

fn save(app: &AppHandle, token: &OAuthToken) -> Result<(), String> {
    let path = refresh_path(app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    // shortcut: refresh token is plaintext in app data; move to the OS keychain before shipping widely.
    // write then rename: a kill mid-write used to leave an empty file, and the old token is already spent by then
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &token.refresh_token).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

fn client(client_id: &str, browser: bool) -> Result<OAuthClient, String> {
    if client_id.len() != 32 || !client_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Enter a valid Spotify client ID (32 hexadecimal characters).".into());
    }
    let b = OAuthClientBuilder::new(client_id, REDIRECT_URI, SCOPES.to_vec()).with_custom_message(DONE_PAGE);
    if browser { b.open_in_browser() } else { b }.build().map_err(|e| e.to_string())
}

async fn refresh(app: &AppHandle, client_id: &str, refresh_token: &str) -> Result<OAuthToken, String> {
    let mut token = client(client_id, false)?.refresh_token_async(refresh_token).await.map_err(|e| e.to_string())?;
    // Spotify doesn't always rotate it: an empty one saved over the old one logged you out on the next start
    if token.refresh_token.is_empty() {
        token.refresh_token = refresh_token.to_string();
    }
    save(app, &token)?;
    Ok(token)
}

#[tauri::command]
fn has_saved_login(app: AppHandle) -> bool {
    refresh_path(&app).ok().and_then(|p| fs::metadata(p).ok()).is_some_and(|m| m.len() > 0)
}

/// Signs in silently with the saved refresh token, or opens the browser the first time.
#[tauri::command]
async fn login(app: AppHandle, state: State<'_, AppState>, client_id: String) -> Result<(), String> {
    let mut slot = state.0.lock().await;
    if slot.is_some() {
        return Ok(());
    }
    client(&client_id, false)?;
    let saved = fs::read_to_string(refresh_path(&app)?).ok();
    let token = match saved {
        Some(rt) => match refresh(&app, &client_id, rt.trim()).await {
            Ok(t) => t,
            // Revoked or expired refresh token: fall back to a fresh browser sign-in.
            Err(_) => browser_login(&app, &client_id).await?,
        },
        None => browser_login(&app, &client_id).await?,
    };
    *slot = Some((token, client_id));
    Ok(())
}

async fn browser_login(app: &AppHandle, client_id: &str) -> Result<OAuthToken, String> {
    let token = client(client_id, true)?.get_access_token_async().await.map_err(|e| e.to_string())?;
    save(app, &token)?;
    Ok(token)
}

/// Access token for the Web Playback SDK / Web API, refreshed a minute before it expires.
#[tauri::command]
async fn token(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let mut slot = state.0.lock().await;
    let (current, client_id) = slot.as_ref().ok_or("not signed in")?;
    if current.expires_at <= Instant::now() + Duration::from_secs(60) {
        let rt = current.refresh_token.clone();
        let client_id = client_id.clone();
        *slot = Some((refresh(&app, &client_id, &rt).await?, client_id));
    }
    Ok(slot.as_ref().unwrap().0.access_token.clone())
}

#[tauri::command]
async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    *state.0.lock().await = None;
    let _ = fs::remove_file(refresh_path(&app)?);
    Ok(())
}

// One HTTP client for the whole app: shares its connection pool and TLS setup instead of rebuilding them per request.
static HTTP: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Helios/0.1")
        .timeout(Duration::from_secs(8))
        .build()
        .expect("HTTP client")
});

// Lyrics sources without CORS headers are fetched here. Allowlisted so this can't become an open proxy.
const LYRICS_HOSTS: &[&str] = &["music.163.com"];

#[tauri::command]
async fn fetch_lyrics_source(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(|h| LYRICS_HOSTS.contains(&h)) {
        return Err(format!("host not allowed: {url}"));
    }
    let res = HTTP
        .get(parsed)
        .header("Referer", "https://music.163.com")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("lyrics source returned {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

// ---- keyless YouTube search via the web client's own "Innertube" API (no API key, no daily quota) ----

#[derive(serde::Serialize)]
struct YtId {
    #[serde(rename = "videoId")]
    video_id: String,
}
#[derive(serde::Serialize)]
struct YtSnippet {
    title: String,
    #[serde(rename = "channelTitle")]
    channel_title: String,
    /// YouTube's "Official Artist Channel" note badge.
    #[serde(rename = "officialArtist")]
    official_artist: bool,
    /// Length in seconds (0 = unknown), from "3:44" or "1:02:03".
    #[serde(rename = "lengthS")]
    length_s: u32,
}
#[derive(serde::Serialize)]
struct YtItem {
    id: YtId,
    snippet: YtSnippet,
}

/// Finds every `videoRenderer` anywhere in the response, so small layout changes on YouTube's side don't break it.
const MAX_VIDEOS: usize = 15;
fn collect_videos(v: &serde_json::Value, out: &mut Vec<YtItem>) {
    if out.len() >= MAX_VIDEOS {
        return; // enough results; skip the rest of the (large) response
    }
    match v {
        serde_json::Value::Object(map) => {
            if let Some(r) = map.get("videoRenderer") {
                let text = |p: &str| r.pointer(p).and_then(|x| x.as_str()).map(str::to_owned);
                if let (Some(id), Some(title)) = (text("/videoId"), text("/title/runs/0/text")) {
                    let channel = text("/ownerText/runs/0/text").unwrap_or_default();
                    let official_artist = r.get("ownerBadges").and_then(|b| b.as_array()).is_some_and(|b| {
                        b.iter().any(|x| x.pointer("/metadataBadgeRenderer/style").and_then(|s| s.as_str()) == Some("BADGE_STYLE_TYPE_VERIFIED_ARTIST"))
                    });
                    let length_s = text("/lengthText/simpleText")
                        .map(|s| s.split(':').fold(0u32, |acc, p| acc * 60 + p.trim().parse::<u32>().unwrap_or(0)))
                        .unwrap_or(0);
                    out.push(YtItem { id: YtId { video_id: id }, snippet: YtSnippet { title, channel_title: channel, official_artist, length_s } });
                }
            }
            map.values().for_each(|x| collect_videos(x, out));
        }
        serde_json::Value::Array(items) => items.iter().for_each(|x| collect_videos(x, out)),
        _ => {}
    }
}

#[tauri::command]
async fn youtube_search(query: String) -> Result<Vec<YtItem>, String> {
    let body = serde_json::json!({
        "context": { "client": { "clientName": "WEB", "clientVersion": "2.20250101.00.00", "hl": "en", "gl": "US" } },
        "query": query,
        "params": "EgIQAQ==", // "videos only" filter
    });
    let res = HTTP
        .post("https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("YouTube search returned {}", res.status()));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    collect_videos(&json, &mut out);
    out.truncate(MAX_VIDEOS);
    Ok(out)
}

/// Windowed fullscreen: fills the screen but stays a normal window (no separate Space on macOS,
/// borderless window over the monitor elsewhere). Returns the new state.
#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    let on = {
        use std::sync::atomic::{AtomicBool, Ordering};
        static ON: AtomicBool = AtomicBool::new(false); // macOS doesn't report simple fullscreen via is_fullscreen
        !ON.fetch_xor(true, Ordering::Relaxed)
    };
    #[cfg(not(target_os = "macos"))]
    let on = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_simple_fullscreen(on).map_err(|e| e.to_string())?;
    Ok(on)
}

/// While minimized, ask WebView2 to drop caches and trim memory; music keeps playing. Back to normal on restore.
#[cfg(windows)]
fn trim_when_minimized(window: &tauri::Window) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    static LOW: AtomicBool = AtomicBool::new(false);

    let minimized = window.is_minimized().unwrap_or(false);
    if LOW.swap(minimized, Ordering::Relaxed) == minimized {
        return;
    }
    let Some(webview) = window.get_webview_window(window.label()) else { return };
    let _ = webview.with_webview(move |w| unsafe {
        if let Ok(core) = w.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_19>()) {
            let level = if minimized { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
            let _ = core.SetMemoryUsageTargetLevel(level);
        }
    });
}

/// Settings > "Limit memory use": the budget in MB for the memory watchdog, 0 for none.
#[tauri::command]
fn set_memory_budget(mb: usize) {
    #[cfg(windows)]
    mem::BUDGET_MB.store(mb, std::sync::atomic::Ordering::Relaxed);
    #[cfg(not(windows))]
    let _ = mb;
}

#[cfg(test)]
mod tests {
    #[test]
    fn client_id_must_be_32_hex_characters() {
        assert!(super::client("0123456789abcdef0123456789abcdef", false).is_ok());
        assert!(super::client("", false).is_err());
        assert!(super::client("0123456789abcdef0123456789abcdeg", false).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build()) // remembers size & position
        .on_window_event(|_window, _event| {
            #[cfg(windows)]
            if let tauri::WindowEvent::Resized(_) = _event {
                trim_when_minimized(_window);
            }
        })
        .manage(AppState::default())
        .manage(viz::Viz::default())
        .setup(|_app| {
            #[cfg(windows)]
            mem::watch(_app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![has_saved_login, login, token, logout, fetch_lyrics_source, youtube_search, toggle_fullscreen, set_memory_budget, viz::viz_start, viz::viz_stop])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
