use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecursiveMode, Watcher,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    time::{Duration, Instant, SystemTime},
};
use tauri::{Emitter, State};

const SETTLE: Duration = Duration::from_millis(750);

#[derive(Default)]
pub(crate) struct FileWatches(Mutex<HashMap<String, mpsc::Sender<()>>>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    watch_id: String,
    revision: u64,
    kind: &'static str,
    detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
enum Stamp {
    Present(u64, Option<SystemTime>, Option<SystemTime>),
    Missing,
    Error(String),
}

fn stamp(path: &Path) -> Stamp {
    match std::fs::metadata(path) {
        Ok(m) => Stamp::Present(m.len(), m.modified().ok(), m.created().ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Stamp::Missing,
        Err(e) => Stamp::Error(e.to_string()),
    }
}

#[derive(Default)]
struct Pending {
    changed: Option<Instant>,
    renamed: bool,
    replaced: bool,
}

impl Pending {
    fn record(&mut self, event: &Event, path: &Path) {
        if !event.paths.iter().any(|p| p == path) || matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        self.changed = Some(Instant::now());
        self.renamed |= matches!(
            event.kind,
            EventKind::Modify(ModifyKind::Name(RenameMode::From | RenameMode::Both))
        ) && event.paths.first().is_some_and(|p| p == path);
        self.replaced |= matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        );
    }
}

fn run_watch(
    path: PathBuf,
    watch_id: String,
    events: mpsc::Receiver<notify::Result<Event>>,
    stop: mpsc::Receiver<()>,
    mut previous: Stamp,
    mut emit: impl FnMut(Change),
) {
    let mut pending = Pending::default();
    let mut revision = 0;
    let mut last_error = None;
    loop {
        match stop.try_recv() {
            Ok(()) | Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        match events.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => {
                if event.need_rescan() {
                    pending.changed = Some(Instant::now());
                }
                pending.record(&event, &path);
            }
            Ok(Err(error)) => {
                let detail = error.to_string();
                if last_error.as_ref() != Some(&detail) {
                    revision += 1;
                    emit(Change {
                        watch_id: watch_id.clone(),
                        revision,
                        kind: "error",
                        detail: Some(detail.clone()),
                    });
                    last_error = Some(detail);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if pending.changed.is_none_or(|at| at.elapsed() < SETTLE) {
            continue;
        }
        let next = stamp(&path);
        if next != previous {
            let (kind, detail) = match &next {
                Stamp::Present(..) => (
                    if pending.replaced {
                        "replaced"
                    } else {
                        "modified"
                    },
                    None,
                ),
                Stamp::Missing => (
                    if pending.renamed {
                        "renamed"
                    } else {
                        "deleted"
                    },
                    None,
                ),
                Stamp::Error(detail) => ("error", Some(detail.clone())),
            };
            revision += 1;
            emit(Change {
                watch_id: watch_id.clone(),
                revision,
                kind,
                detail,
            });
            previous = next;
        }
        pending = Pending::default();
    }
}

#[tauri::command]
pub(crate) fn start_file_watch(
    path: String,
    watch_id: String,
    app: tauri::AppHandle,
    state: State<'_, FileWatches>,
) -> Result<(), String> {
    if watch_id.is_empty() || watch_id.len() > 128 {
        return Err("Invalid watch id".into());
    }
    let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let parent = path.parent().ok_or("File has no parent directory")?;
    let (tx, events) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(parent, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    let previous = stamp(&path);
    let (stop_tx, stop_rx) = mpsc::channel();
    {
        let mut watches = state.0.lock().map_err(|e| e.to_string())?;
        // The main window watches one file. Also retire watches orphaned by a
        // webview refresh, where React cleanup cannot send stop_file_watch.
        watches.clear();
        watches.insert(watch_id.clone(), stop_tx);
    }
    std::thread::spawn(move || {
        let _watcher = watcher;
        run_watch(path, watch_id, events, stop_rx, previous, |change| {
            let _ = app.emit("yw-look://file-changed", change);
        });
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn stop_file_watch(watch_id: String, state: State<'_, FileWatches>) {
    if let Ok(mut watches) = state.0.lock() {
        watches.remove(&watch_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Uses the actual OS watcher, including Windows replacement-save semantics.
    #[test]
    fn native_watch_coalesces_saves_and_survives_replacement() {
        for extension in ["fbx", "glb", "usda"] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join(format!("asset.{extension}"));
            std::fs::write(&path, b"original").unwrap();
            let path = path.canonicalize().unwrap();
            let (tx, events) = mpsc::channel();
            let mut watcher = notify::recommended_watcher(tx).unwrap();
            watcher
                .watch(path.parent().unwrap(), RecursiveMode::NonRecursive)
                .unwrap();
            let (stop_tx, stop_rx) = mpsc::channel();
            let (change_tx, changes) = mpsc::channel();
            let initial = stamp(&path);
            let watched = path.clone();
            let worker = std::thread::spawn(move || {
                let _watcher = watcher;
                run_watch(watched, "test".into(), events, stop_rx, initial, |change| {
                    change_tx.send(change).unwrap();
                });
            });
            let next = || {
                changes
                    .recv_timeout(Duration::from_secs(5))
                    .expect("OS change notification")
            };
            std::fs::write(&path, b"save part one").unwrap();
            std::fs::write(&path, b"save part two complete").unwrap();
            assert_eq!(next().kind, "modified");
            assert!(
                changes.recv_timeout(Duration::from_millis(950)).is_err(),
                "one notification per save burst"
            );
            let replacement = path.with_extension("tmp");
            std::fs::write(&replacement, b"replacement").unwrap();
            std::fs::remove_file(&path).unwrap();
            std::fs::rename(&replacement, &path).unwrap();
            assert_eq!(next().kind, "replaced");
            std::fs::write(&path, b"after replacement").unwrap();
            assert_eq!(next().kind, "modified");
            std::fs::rename(&path, path.with_extension("renamed")).unwrap();
            assert_eq!(next().kind, "renamed");
            std::fs::write(&path, b"restored").unwrap();
            assert_eq!(next().kind, "replaced");
            std::fs::remove_file(&path).unwrap();
            assert_eq!(next().kind, "deleted");
            drop(stop_tx);
            worker.join().unwrap();
        }
    }

    #[test]
    fn ignores_reads_and_unrelated_sibling_writes() {
        let path = Path::new("asset.glb");
        let mut pending = Pending::default();
        pending.record(
            &Event::new(EventKind::Modify(ModifyKind::Any)).add_path("sidecar.png".into()),
            path,
        );
        pending.record(
            &Event::new(EventKind::Access(notify::event::AccessKind::Any)).add_path(path.into()),
            path,
        );
        assert!(pending.changed.is_none());
    }
}
