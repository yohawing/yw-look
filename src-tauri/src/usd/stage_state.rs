//! Tauri-managed registry of opened USD stages (#44 — per-prim payload
//! session). Each `open_stage_session` Tauri command stores its concrete
//! `Stage` (or C++ shim handle) here and returns a `StageSessionHandle`
//! integer the frontend uses for follow-up `load_payload` /
//! `unload_payload` / `extract_geometry_session` calls.
//!
//! The registry is bound to the app lifetime; closing the file (or app)
//! drops every session via `close_stage_session`.
//!
//! Thread-safety note: `StageRegistry` wraps each `OpenStage` variant in a
//! `Mutex` so the registry itself is `Send + Sync` — required by Tauri's
//! `app.manage()`. The `CStage` handle is explicitly NOT `Sync` (only
//! `Send`), so we keep it behind a per-session `Mutex<CStage>`. The
//! registry map stores sessions behind `Arc` handles so lookup only holds
//! the map lock long enough to clone the session pointer; heavyweight stage
//! operations contend only on the individual session's stage mutex.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use super::types::StageLoadPolicy;

/// An opaque integer token the frontend uses to identify an open stage
/// session. Serialized as a plain number (transparent newtype).
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct StageSessionHandle(pub u64);

/// The backend-specific stage object held for the lifetime of a session.
///
/// `Rust` wraps an `openusd::Stage` from the Rust-fork backend.
/// `Cpp` wraps a `CStage` from the C++ shim backend.
///
/// Both variants are behind a `Mutex` so the enum itself is `Send + Sync`
/// regardless of whether the inner handle is `Sync` on its own. The Mutex
/// is used exclusively by the Tauri commands; normal single-threaded usage
/// (tests, blocking tasks) can lock without contention.
pub enum OpenStage {
    #[cfg(feature = "backend-openusd-rs")]
    Rust(Mutex<openusd::Stage>),
    #[cfg(feature = "backend-openusd-cpp")]
    Cpp(Mutex<super::cpp_sys::CStage>),
}

// SAFETY: both `openusd::Stage` and `CStage` are opened fresh by the
// calling thread and are NOT shared across threads except through
// `Mutex`. Neither variant exposes a shared `*const` or `*mut` raw
// pointer outside of locked critical sections.
unsafe impl Send for OpenStage {}
unsafe impl Sync for OpenStage {}

/// One open session: the backing stage object plus the original path and
/// load policy so callers can inspect the session's provenance.
pub struct OpenSession {
    /// Absolute path to the USD file that was opened.
    pub path: PathBuf,
    /// Load policy used when the stage was originally opened.
    pub policy: StageLoadPolicy,
    /// The concrete stage handle for this backend.
    pub stage: OpenStage,
}

/// App-lifetime registry of stage sessions. Registered with Tauri via
/// `app.manage(StageRegistry::new())` so it is accessible from any
/// Tauri command as `tauri::State<'_, StageRegistry>`.
pub struct StageRegistry {
    next: AtomicU64,
    sessions: Mutex<HashMap<u64, Arc<OpenSession>>>,
}

impl StageRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self {
            next: AtomicU64::new(1), // start from 1; 0 can be used as a sentinel
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Inserts a new session and returns its handle.
    pub fn insert(&self, session: OpenSession) -> StageSessionHandle {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut map = self.sessions.lock().expect("StageRegistry lock poisoned");
        map.insert(id, Arc::new(session));
        StageSessionHandle(id)
    }

    /// Removes and returns the session handle for `handle`, or `None` if it
    /// does not exist. In-flight operations that already cloned the `Arc`
    /// keep the session alive until they finish; future lookups fail.
    pub fn remove(&self, handle: StageSessionHandle) -> Option<Arc<OpenSession>> {
        let mut map = self.sessions.lock().expect("StageRegistry lock poisoned");
        map.remove(&handle.0)
    }

    /// Returns a cloned session handle for `handle`.
    pub fn get(&self, handle: StageSessionHandle) -> Option<Arc<OpenSession>> {
        let map = self.sessions.lock().expect("StageRegistry lock poisoned");
        map.get(&handle.0).cloned()
    }

    /// Calls `f` with a shared reference to the session for `handle`.
    /// Returns `None` when the handle is unknown.
    pub fn with<F, R>(&self, handle: StageSessionHandle, f: F) -> Option<R>
    where
        F: FnOnce(&OpenSession) -> R,
    {
        self.get(handle).map(|session| f(&session))
    }

    /// Returns the number of open sessions.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.sessions
            .lock()
            .expect("StageRegistry lock poisoned")
            .len()
    }
}

impl Default for StageRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(all(test, feature = "backend-openusd-rs"))]
mod tests {
    use super::*;
    use crate::usd::{OpenusdBackend, UsdSessionBackend};
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    fn tiny_usda_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("samples")
            .join("assets")
            .join("usd")
            .join("tiny.usda")
    }

    fn open_test_session(backend: &OpenusdBackend) -> OpenSession {
        let path = tiny_usda_path();
        let policy = StageLoadPolicy::default();
        let stage = backend
            .open_stage_session(&path, policy)
            .expect("open tiny.usda test session");
        OpenSession {
            path,
            policy,
            stage,
        }
    }

    #[test]
    fn with_does_not_hold_registry_lock_while_running_closure() {
        let backend = OpenusdBackend::new();
        let registry = Arc::new(StageRegistry::new());
        let active = registry.insert(open_test_session(&backend));
        let removable = registry.insert(open_test_session(&backend));

        registry
            .with(active, |_| {
                let (tx, rx) = mpsc::channel();
                let registry = Arc::clone(&registry);
                std::thread::spawn(move || {
                    let removed = registry.remove(removable).is_some();
                    tx.send(removed).expect("send remove result");
                });

                assert_eq!(
                    rx.recv_timeout(Duration::from_secs(1)),
                    Ok(true),
                    "registry map lock stayed held while with() closure was running"
                );
            })
            .expect("active session exists");

        assert_eq!(registry.len(), 1);
    }
}
