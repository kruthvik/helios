//! Memory budget for the whole app: this process and every WebView2 process under it (browser, GPU, renderers,
//! utilities), counted as private working set, the "Memory" figure Task Manager shows. Off unless switched on in
//! Settings ("Limit memory use"): holding the sum under the budget can cost a dropped frame now and then.
//!
//! Most of the time nothing happens: the usual total is well below the budget. Past the high mark (a 4K music video,
//! hours of heap growth) the excess is handed back to Windows, one process a second, largest first, by trimming its
//! least recently used pages. Memory a process isn't touching (most of the GPU process's heaps, old fragmented
//! pages) stays out, at no cost to what's on screen. A process that takes its memory straight back is using it:
//! trimming that one again would only cost frames, so it's left alone for ten minutes, unless the total is at the
//! budget itself. The page hears about it too ("memory-pressure"): it collects garbage, and at the budget itself it
//! lightens what it can (see `view.lowMem`).

use std::{
    collections::{HashMap, HashSet},
    mem::size_of,
    sync::atomic::{AtomicUsize, Ordering},
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
        Memory::{GetProcessWorkingSetSizeEx, SetProcessWorkingSetSizeEx, QUOTA_LIMITS_HARDWS_MAX_ENABLE, QUOTA_LIMITS_HARDWS_MIN_DISABLE, SETPROCESSWORKINGSETSIZEEX_FLAGS},
        ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2},
        Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA},
    },
};

const MB: usize = 1 << 20;
const FLOOR: usize = 40 * MB; // no process is trimmed below this

/// The marks the watchdog works with, from the budget.
#[derive(Clone, Copy)]
struct Marks {
    high: usize,   // above this the excess is shed...
    target: usize, // ...down to about here
    hard: usize,   // this close to the budget, busy processes are trimmed as well
}
fn marks(budget: usize) -> Marks {
    Marks { high: budget / 100 * 88, target: budget / 100 * 78, hard: budget / 100 * 96 }
}
const HOT_FOR: Duration = Duration::from_secs(600);

struct Proc {
    pid: u32,
    handle: HANDLE,
    private: usize,
    total: usize,
}
impl Drop for Proc {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

impl Proc {
    fn open(pid: u32) -> Option<Proc> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, false, pid).ok()?;
            let mut p = Proc { pid, handle, private: 0, total: 0 };
            let mut c = PROCESS_MEMORY_COUNTERS_EX2 { cb: size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32, ..Default::default() };
            // the EX2 form (with the private working set) needs a current Windows 10 or 11; without it, no watchdog
            GetProcessMemoryInfo(handle, &mut c as *mut _ as *mut PROCESS_MEMORY_COUNTERS, c.cb).ok()?;
            p.private = c.PrivateWorkingSetSize;
            p.total = c.WorkingSetSize;
            Some(p)
        }
    }

    /// Takes about `cut` bytes out of the working set: a hard maximum makes Windows trim the least recently used
    /// pages down to it, and is lifted again at once, so the process is never held to it.
    fn trim(&self, cut: usize) {
        unsafe {
            let (mut min, mut max, mut flags) = (0, 0, 0);
            if !GetProcessWorkingSetSizeEx(self.handle, &mut min, &mut max, &mut flags).as_bool() {
                return;
            }
            let to = self.total.saturating_sub(cut).max(FLOOR);
            if SetProcessWorkingSetSizeEx(self.handle, min.min(to / 2), to, QUOTA_LIMITS_HARDWS_MAX_ENABLE | QUOTA_LIMITS_HARDWS_MIN_DISABLE).is_ok() {
                let _ = SetProcessWorkingSetSizeEx(self.handle, min, max, SETPROCESSWORKINGSETSIZEEX_FLAGS(flags));
            }
        }
    }
}

/// This process and the WebView2 processes below it.
fn tree() -> Vec<Proc> {
    let mut all = Vec::new(); // (pid, parent, is a WebView2 process)
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return Vec::new() };
        let mut e = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(snap, &mut e).is_ok();
        while more {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            let webview = String::from_utf16_lossy(&e.szExeFile[..len]).eq_ignore_ascii_case("msedgewebview2.exe");
            all.push((e.th32ProcessID, e.th32ParentProcessID, webview));
            more = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    let mut ids = vec![std::process::id()];
    let mut i = 0;
    while i < ids.len() {
        // only WebView2 children: a recycled process id must never pull an unrelated program into the tree
        let children: Vec<u32> = all.iter().filter(|&&(pid, parent, webview)| parent == ids[i] && webview && !ids.contains(&pid)).map(|p| p.0).collect();
        ids.extend(children);
        i += 1;
    }
    ids.into_iter().filter_map(Proc::open).collect()
}

/// The next process to trim and by how much: of those with something to give that aren't skipped, one known to
/// leave its memory out (`cold`) before one not tried yet, the largest first; for the excess, or as much of it as
/// the process has above the floor.
fn pick(procs: &[(u32, usize)], excess: usize, skip: impl Fn(u32) -> bool, cold: impl Fn(u32) -> bool) -> Option<(u32, usize)> {
    let &(pid, private) = procs.iter().filter(|p| p.1 > FLOOR + MB && !skip(p.0)).max_by_key(|p| (cold(p.0), p.1))?;
    Some((pid, excess.min(private - FLOOR)))
}

/// The budget in MB, from Settings ("Limit memory use"); 0, the default, is no limit and the watchdog idles.
pub static BUDGET_MB: AtomicUsize = AtomicUsize::new(0);

pub fn watch(app: AppHandle) {
    let run = move || {
        let mut last: Option<(u32, usize, usize)> = None; // the last trim: pid, its size before, bytes asked for
        let mut hot: HashMap<u32, Instant> = HashMap::new(); // processes that took their memory straight back
        let mut cold: HashSet<u32> = HashSet::new(); // ...and those that left it out
        let mut shedding = false;
        let mut at_hard = 0; // seconds in a row at the hard mark
        let mut told: Option<(Instant, bool)> = None;
        loop {
            let budget = BUDGET_MB.load(Ordering::Relaxed);
            if budget == 0 {
                (last, shedding, at_hard) = (None, false, 0);
                thread::sleep(Duration::from_secs(1));
                continue;
            }
            let m = marks(budget * MB);
            let procs = tree();
            let now = Instant::now();
            let sizes: Vec<_> = procs.iter().map(|p| (p.pid, p.private)).collect();
            let total: usize = sizes.iter().map(|p| p.1).sum();
            // a second after a trim: back already means in use. (Growing back over minutes is fine to trim again.)
            if let Some((pid, before, cut)) = last.take() {
                if sizes.iter().any(|&(p, private)| p == pid && private + cut / 2 > before) {
                    hot.insert(pid, now + HOT_FOR);
                    cold.remove(&pid);
                } else {
                    cold.insert(pid);
                }
            }
            cold.retain(|pid| sizes.iter().any(|p| p.0 == *pid));
            hot.retain(|_, until| *until > now);
            // from the high mark down to the target, then quiet until the high mark is crossed again
            shedding = total > m.high || (shedding && total > m.target);
            if shedding {
                let next = pick(&sizes, total.saturating_sub(m.target), |pid| total < m.hard && hot.contains_key(&pid), |pid| cold.contains(&pid));
                if let Some((p, cut)) = next.and_then(|(pid, cut)| Some((procs.iter().find(|p| p.pid == pid)?, cut))) {
                    p.trim(cut);
                    last = Some((p.pid, p.private, cut));
                }
            }
            // every ten seconds while it lasts, and at once when it stays at the budget itself (three seconds: a
            // spike that trimming takes care of doesn't count)
            at_hard = if total >= m.hard { at_hard + 1 } else { 0 };
            let hard = at_hard >= 3;
            if total > m.high && told.is_none_or(|(at, was_hard)| at.elapsed() > Duration::from_secs(10) || (hard && !was_hard)) {
                let _ = app.emit("memory-pressure", hard); // true: lighten the load
                told = Some((now, hard));
            }
            drop(procs);
            thread::sleep(Duration::from_secs(1));
        }
    };
    let _ = thread::Builder::new().name("memory".into()).spawn(run);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_the_largest_process_that_can_give() {
        let procs = [(1, 300 * MB), (2, 140 * MB), (3, 30 * MB)];
        let (no, yes) = (|_| false, |_| true);
        assert_eq!(pick(&procs, 50 * MB, no, no), Some((1, 50 * MB)));
        assert_eq!(pick(&procs, 500 * MB, no, no), Some((1, 260 * MB))); // never below its floor
        assert_eq!(pick(&procs, 50 * MB, |pid| pid == 1, no), Some((2, 50 * MB))); // a busy one is passed over
        assert_eq!(pick(&procs, 50 * MB, no, |pid| pid == 2), Some((2, 50 * MB))); // one known to give comes first
        assert_eq!(pick(&procs, 50 * MB, |pid| pid != 3, yes), None); // what's left is already under the floor
        let m = marks(500 * MB);
        assert!(m.target < m.high && m.high < m.hard && m.hard < 500 * MB);
    }
}
