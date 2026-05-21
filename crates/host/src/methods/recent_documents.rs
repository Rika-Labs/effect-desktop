#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    CanonicalPathPayload, HostProtocolEnvelope, HostProtocolError, RecentDocumentPayload,
    RecentDocumentsAddPayload, RecentDocumentsEventPayload, RecentDocumentsEventPhasePayload,
    RecentDocumentsListResultPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::sync::mpsc::Sender;
use uuid::Uuid;

#[cfg(test)]
pub(crate) fn add(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    add_with_event_sender(payload, None)
}

pub(crate) fn add_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<RecentDocumentsAddPayload>(
        payload,
        host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
    )?;
    platform_add(
        input.path().path(),
        host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
    )?;
    send_event(
        event_sender,
        RecentDocumentsEventPayload::new(
            RecentDocumentsEventPhasePayload::DocumentAdded,
            Some(CanonicalPathPayload::new(input.path().path())),
            None,
        ),
    );
    Ok(None)
}

#[cfg(test)]
pub(crate) fn clear(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    clear_with_event_sender(payload, None)
}

pub(crate) fn clear_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD)?;
    platform_clear(host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD)?;
    send_event(
        event_sender,
        RecentDocumentsEventPayload::new(RecentDocumentsEventPhasePayload::Cleared, None, None),
    );
    Ok(None)
}

pub(crate) fn list(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::RECENT_DOCUMENTS_LIST_METHOD)?;
    let documents = platform_list(host_protocol::RECENT_DOCUMENTS_LIST_METHOD)?
        .into_iter()
        .map(|path| {
            validate_platform_path(&path, host_protocol::RECENT_DOCUMENTS_LIST_METHOD)?;
            Ok(RecentDocumentPayload::new(CanonicalPathPayload::new(path)))
        })
        .collect::<Result<Vec<_>, HostProtocolError>>()?;
    encode_payload(
        RecentDocumentsListResultPayload::new(documents),
        host_protocol::RECENT_DOCUMENTS_LIST_METHOD,
    )
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let payload = payload
        .ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))?;
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode recent document payload: {error}"),
            operation,
        )
    })
}

fn reject_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Object(object)) if object.is_empty() => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
}

fn validate_path(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if path.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must be non-empty",
            operation,
        ));
    }
    if path.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must not contain control characters",
            operation,
        ));
    }
    if !is_safe_absolute_path(path) {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must be an absolute path without dot segments",
            operation,
        ));
    }
    Ok(())
}

fn validate_platform_path(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if path.is_empty() || path.chars().any(char::is_control) || !is_safe_absolute_path(path) {
        return Err(HostProtocolError::internal(
            "platform returned an unsafe recent document path",
            operation,
        ));
    }
    Ok(())
}

fn is_safe_absolute_path(path: &str) -> bool {
    if path.starts_with('/') {
        return !has_dot_path_segment(path, '/');
    }
    if is_windows_absolute_path(path) || is_windows_unc_absolute_path(path) {
        return !has_windows_dot_path_segment(path);
    }
    false
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn is_windows_unc_absolute_path(path: &str) -> bool {
    if !path.starts_with("\\\\") {
        return false;
    }
    let mut segments = path.split(['\\', '/']);
    matches!(segments.next(), Some(""))
        && matches!(segments.next(), Some(""))
        && segments.next().is_some_and(|segment| !segment.is_empty())
        && segments.next().is_some_and(|segment| !segment.is_empty())
}

fn has_dot_path_segment(path: &str, separator: char) -> bool {
    path.split(separator)
        .any(|segment| matches!(segment, "." | ".."))
}

fn has_windows_dot_path_segment(path: &str) -> bool {
    path.split(['\\', '/'])
        .any(|segment| matches!(segment, "." | ".."))
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
        operation,
    )
}

fn send_event(sender: Option<Sender<HostProtocolEnvelope>>, payload: RecentDocumentsEventPayload) {
    let Some(sender) = sender else {
        return;
    };
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::RECENT_DOCUMENTS_EVENT.to_string(),
        timestamp: 0,
        trace_id: format!("recent-documents-event-{}", Uuid::now_v7()),
        window_id: None,
        payload: to_value(payload).ok(),
    });
}

#[cfg(all(target_os = "macos", not(test)))]
fn platform_add(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    macos_recent_documents::add(path, operation)
}

#[cfg(all(windows, not(test)))]
fn platform_add(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    windows_recent_documents::add(path, operation)
}

#[cfg(all(target_os = "linux", not(test)))]
fn platform_add(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    linux_recent_documents::add(path, operation)
}

#[cfg(any(
    test,
    all(
        not(target_os = "macos"),
        not(windows),
        not(target_os = "linux"),
        not(test)
    )
))]
fn platform_add(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    test_recent_documents_add(path).unwrap_or_else(|| Err(unsupported(operation)))
}

#[cfg(all(target_os = "macos", not(test)))]
fn platform_clear(operation: &'static str) -> Result<(), HostProtocolError> {
    macos_recent_documents::clear(operation)
}

#[cfg(all(windows, not(test)))]
fn platform_clear(operation: &'static str) -> Result<(), HostProtocolError> {
    windows_recent_documents::clear(operation)
}

#[cfg(all(target_os = "linux", not(test)))]
fn platform_clear(operation: &'static str) -> Result<(), HostProtocolError> {
    linux_recent_documents::clear(operation)
}

#[cfg(any(
    test,
    all(
        not(target_os = "macos"),
        not(windows),
        not(target_os = "linux"),
        not(test)
    )
))]
fn platform_clear(operation: &'static str) -> Result<(), HostProtocolError> {
    test_recent_documents_clear().unwrap_or_else(|| Err(unsupported(operation)))
}

#[cfg(all(target_os = "macos", not(test)))]
fn platform_list(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
    macos_recent_documents::list(operation)
}

#[cfg(any(not(target_os = "macos"), test))]
fn platform_list(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
    test_recent_documents_list().unwrap_or_else(|| Err(unsupported(operation)))
}

#[cfg(any(not(target_os = "macos"), test))]
fn test_recent_documents_add(path: &str) -> Option<Result<(), HostProtocolError>> {
    #[cfg(test)]
    {
        TEST_RECENT_DOCUMENTS.with(|state| {
            let mut state = state.borrow_mut();
            let documents = state.as_mut()?;
            documents.retain(|document| document != path);
            documents.insert(0, path.to_string());
            Some(Ok(()))
        })
    }
    #[cfg(not(test))]
    {
        let _ = path;
        None
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn test_recent_documents_clear() -> Option<Result<(), HostProtocolError>> {
    #[cfg(test)]
    {
        TEST_RECENT_DOCUMENTS.with(|state| {
            let mut state = state.borrow_mut();
            let documents = state.as_mut()?;
            documents.clear();
            Some(Ok(()))
        })
    }
    #[cfg(not(test))]
    {
        None
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn test_recent_documents_list() -> Option<Result<Vec<String>, HostProtocolError>> {
    #[cfg(test)]
    {
        TEST_RECENT_DOCUMENTS.with(|state| {
            let state = state.borrow();
            let documents = state.as_ref()?;
            Some(Ok(documents.clone()))
        })
    }
    #[cfg(not(test))]
    {
        None
    }
}

#[cfg(all(windows, not(test)))]
mod windows_recent_documents {
    use super::HostProtocolError;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHAddToRecentDocs, SHARD_PATHW, SHARD_PIDL};

    pub(super) fn add(path: &str, _operation: &'static str) -> Result<(), HostProtocolError> {
        let wide_path = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        unsafe {
            SHAddToRecentDocs(SHARD_PATHW as u32, wide_path.as_ptr().cast());
        }
        Ok(())
    }

    pub(super) fn clear(_operation: &'static str) -> Result<(), HostProtocolError> {
        unsafe {
            SHAddToRecentDocs(SHARD_PIDL as u32, std::ptr::null());
        }
        Ok(())
    }
}

#[cfg(all(target_os = "linux", not(test)))]
mod linux_recent_documents {
    use super::{unsupported, HostProtocolError};
    use gtk::prelude::RecentManagerExt;

    pub(super) fn add(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
        let manager = manager(operation)?;
        let uri = gtk::glib::filename_to_uri(path, None).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to convert recent document path to URI: {error}"),
                operation,
            )
        })?;
        if manager.add_item(uri.as_str()) {
            Ok(())
        } else {
            Err(unsupported(operation))
        }
    }

    pub(super) fn clear(operation: &'static str) -> Result<(), HostProtocolError> {
        manager(operation)?
            .purge_items()
            .map(|_| ())
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to clear Linux recent documents: {error}"),
                    operation,
                )
            })
    }

    fn manager(operation: &'static str) -> Result<gtk::RecentManager, HostProtocolError> {
        if !gtk::is_initialized_main_thread() {
            return Err(HostProtocolError::internal(
                "Linux recent documents must run on the GTK main thread",
                operation,
            ));
        }
        gtk::RecentManager::default().ok_or_else(|| unsupported(operation))
    }
}

#[cfg(all(target_os = "macos", not(test)))]
mod macos_recent_documents {
    use super::{unsupported, HostProtocolError};
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSDocumentController;
    use objc2_foundation::{NSString, NSURL};

    pub(super) fn add(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
        let controller = document_controller(operation)?;
        let path = NSString::from_str(path);
        let url = NSURL::fileURLWithPath(&path);
        controller.noteNewRecentDocumentURL(&url);
        Ok(())
    }

    pub(super) fn clear(operation: &'static str) -> Result<(), HostProtocolError> {
        let controller = document_controller(operation)?;
        // SAFETY: Passing `None` matches AppKit's accepted nil sender convention.
        unsafe {
            controller.clearRecentDocuments(None);
        }
        Ok(())
    }

    pub(super) fn list(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
        let controller = document_controller(operation)?;
        Ok(controller
            .recentDocumentURLs()
            .iter()
            .filter_map(|url| url.path().map(|path| path.to_string()))
            .collect())
    }

    fn document_controller(
        operation: &'static str,
    ) -> Result<objc2::rc::Retained<NSDocumentController>, HostProtocolError> {
        let Some(marker) = MainThreadMarker::new() else {
            return Err(HostProtocolError::internal(
                "macOS recent documents must run on the main thread",
                operation,
            ));
        };
        let controller = NSDocumentController::sharedDocumentController(marker);
        if controller.maximumRecentDocumentCount() == 0 {
            return Err(unsupported(operation));
        }
        Ok(controller)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        add, add_with_event_sender, clear, clear_with_event_sender, list, TEST_RECENT_DOCUMENTS,
    };
    use host_protocol::{HostProtocolEnvelope, HostProtocolError};
    use serde_json::json;
    use std::sync::mpsc::channel;

    #[test]
    fn recent_document_requests_decode_before_unsupported() {
        assert_eq!(
            add(Some(json!({ "path": { "path": "/tmp/report.txt" } }))).expect_err("add"),
            HostProtocolError::unsupported(
                host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
                host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
            )
        );
        assert_eq!(
            clear(None).expect_err("clear"),
            HostProtocolError::unsupported(
                host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
                host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD,
            )
        );
        assert_eq!(
            list(None).expect_err("list"),
            HostProtocolError::unsupported(
                host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
                host_protocol::RECENT_DOCUMENTS_LIST_METHOD,
            )
        );
    }

    #[test]
    fn recent_document_adapter_adds_lists_clears_and_emits_events() {
        with_recent_documents(vec![], || {
            let (sender, receiver) = channel();

            add_with_event_sender(
                Some(json!({ "path": { "path": "/tmp/report.txt" } })),
                Some(sender.clone()),
            )
            .expect("add should succeed");
            let listed = list(None).expect("list should succeed");
            clear_with_event_sender(None, Some(sender)).expect("clear should succeed");
            let cleared = list(None).expect("list after clear should succeed");

            assert_eq!(
                listed,
                Some(json!({ "documents": [{ "path": { "path": "/tmp/report.txt" } }] }))
            );
            assert_eq!(cleared, Some(json!({ "documents": [] })));
            assert_recent_document_event(
                receiver.recv().expect("add event should emit"),
                "document-added",
                Some("/tmp/report.txt"),
            );
            assert_recent_document_event(
                receiver.recv().expect("clear event should emit"),
                "cleared",
                None,
            );
        });
    }

    #[test]
    fn recent_document_requests_reject_invalid_inputs_before_unsupported() {
        assert_eq!(
            add(Some(json!({ "path": { "path": "relative.txt" } })))
                .expect_err("relative path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "/tmp/bad\u{0}path" } })))
                .expect_err("nul path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "/tmp/bad\npath" } })))
                .expect_err("control path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "/tmp/bad\u{85}path" } })))
                .expect_err("unicode control path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "/tmp/../secret.txt" } })))
                .expect_err("dot segment path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "C:relative.txt" } })))
                .expect_err("drive-relative path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(
                json!({ "path": { "path": "C:\\tmp\\..\\secret.txt" } })
            ))
            .expect_err("windows dot segment path")
            .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "\\\\" } })))
                .expect_err("unc root")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "\\\\server" } })))
                .expect_err("unc server")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "\\\\/server/share" } })))
                .expect_err("mixed unc prefix")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            clear(Some(json!({ "unexpected": true }))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD,
            )
        );
    }

    fn with_recent_documents<R>(documents: Vec<String>, f: impl FnOnce() -> R) -> R {
        TEST_RECENT_DOCUMENTS.with(|state| {
            *state.borrow_mut() = Some(documents);
        });
        let result = f();
        TEST_RECENT_DOCUMENTS.with(|state| {
            *state.borrow_mut() = None;
        });
        result
    }

    fn assert_recent_document_event(event: HostProtocolEnvelope, phase: &str, path: Option<&str>) {
        let HostProtocolEnvelope::Event {
            method, payload, ..
        } = event
        else {
            panic!("expected recent document event");
        };
        assert_eq!(method, host_protocol::RECENT_DOCUMENTS_EVENT);
        let mut expected = json!({ "phase": phase });
        if let Some(path) = path {
            expected["path"] = json!({ "path": path });
        }
        assert_eq!(payload.expect("event should include payload"), expected);
    }
}

#[cfg(test)]
thread_local! {
    static TEST_RECENT_DOCUMENTS: std::cell::RefCell<Option<Vec<String>>> =
        const { std::cell::RefCell::new(None) };
}
