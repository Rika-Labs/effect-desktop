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

use crate::window::WindowMethodHandler;

pub(crate) fn add_on_window(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<RecentDocumentsAddPayload>(
        payload.clone(),
        host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
    )?;
    validate_add_payload(&input, host_protocol::RECENT_DOCUMENTS_ADD_METHOD)?;
    handler.add_recent_document(payload, event_sender)
}

pub(crate) fn clear_on_window(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(
        payload.clone(),
        host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD,
    )?;
    handler.clear_recent_documents(payload, event_sender)
}

pub(crate) fn list_on_window(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload.clone(), host_protocol::RECENT_DOCUMENTS_LIST_METHOD)?;
    handler.list_recent_documents(payload)
}

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
    validate_add_payload(&input, host_protocol::RECENT_DOCUMENTS_ADD_METHOD)?;
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

fn validate_add_payload(
    input: &RecentDocumentsAddPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_path(input.path().path(), operation)
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

#[cfg(all(windows, not(test)))]
fn platform_list(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
    windows_recent_documents::list(operation)
}

#[cfg(all(target_os = "linux", not(test)))]
fn platform_list(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
    linux_recent_documents::list(operation)
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
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::time::SystemTime;
    use windows_sys::{
        core::{IUnknown_Vtbl, GUID, HRESULT, PCWSTR, PWSTR},
        Win32::{
            Foundation::{MAX_PATH, RPC_E_CHANGED_MODE, S_FALSE, S_OK},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
            },
            UI::Shell::{
                FOLDERID_Recent, SHAddToRecentDocs, SHGetKnownFolderPath, SHARD_PATHW, SHARD_PIDL,
            },
        },
    };

    const CLSID_SHELL_LINK: GUID = GUID::from_u128(0x00021401_0000_0000_c000_000000000046);
    const IID_ISHELL_LINK_W: GUID = GUID::from_u128(0x000214f9_0000_0000_c000_000000000046);
    const IID_IPERSIST_FILE: GUID = GUID::from_u128(0x0000010b_0000_0000_c000_000000000046);
    const WINDOWS_MAX_PATH: usize = MAX_PATH as usize;

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

    pub(super) fn list(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
        let recent_folder = recent_folder_path(operation)?;
        let mut shortcuts = recent_shortcuts(&recent_folder, operation)?;
        shortcuts.sort_by(|left, right| right.modified.cmp(&left.modified));

        let _com = ComApartment::initialize(operation)?;
        let mut documents = Vec::new();
        for shortcut in shortcuts {
            let Some(document) = resolve_shortcut_target(&shortcut.path, operation)? else {
                continue;
            };
            if documents
                .iter()
                .all(|existing: &String| !existing.eq_ignore_ascii_case(&document))
            {
                documents.push(document);
            }
        }
        Ok(documents)
    }

    struct RecentShortcut {
        path: PathBuf,
        modified: SystemTime,
    }

    struct ComApartment {
        uninitialize: bool,
    }

    impl ComApartment {
        fn initialize(operation: &'static str) -> Result<Self, HostProtocolError> {
            let result =
                unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) };
            if result == RPC_E_CHANGED_MODE {
                return Ok(Self {
                    uninitialize: false,
                });
            }
            if failed(result) {
                return Err(hresult_error(
                    "failed to initialize COM for Windows recent documents",
                    result,
                    operation,
                ));
            }
            Ok(Self {
                uninitialize: result == S_OK || result == S_FALSE,
            })
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.uninitialize {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    struct ComInterface {
        ptr: *mut c_void,
    }

    impl ComInterface {
        fn from_raw(
            ptr: *mut c_void,
            context: &str,
            operation: &'static str,
        ) -> Result<Self, HostProtocolError> {
            if ptr.is_null() {
                return Err(HostProtocolError::internal(
                    format!("{context}: COM returned a null interface"),
                    operation,
                ));
            }
            Ok(Self { ptr })
        }

        fn as_ptr(&self) -> *mut c_void {
            self.ptr
        }
    }

    impl Drop for ComInterface {
        fn drop(&mut self) {
            unsafe {
                let vtable = *(self.ptr as *mut *const IUnknown_Vtbl);
                ((*vtable).Release)(self.ptr);
            }
        }
    }

    #[repr(C)]
    struct IShellLinkWVTable {
        _i_unknown: IUnknown_Vtbl,
        get_path: unsafe extern "system" fn(*mut c_void, PWSTR, i32, *mut c_void, u32) -> HRESULT,
    }

    #[repr(C)]
    struct IPersistFileVTable {
        _i_unknown: IUnknown_Vtbl,
        _get_class_id: unsafe extern "system" fn(*mut c_void, *mut GUID) -> HRESULT,
        _is_dirty: unsafe extern "system" fn(*mut c_void) -> HRESULT,
        load: unsafe extern "system" fn(*mut c_void, PCWSTR, u32) -> HRESULT,
    }

    fn recent_folder_path(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
        let mut path = std::ptr::null_mut();
        let result =
            unsafe { SHGetKnownFolderPath(&FOLDERID_Recent, 0, std::ptr::null_mut(), &mut path) };
        if failed(result) {
            return Err(hresult_error(
                "failed to locate the Windows Recent Items folder",
                result,
                operation,
            ));
        }
        if path.is_null() {
            return Err(HostProtocolError::internal(
                "Windows Recent Items folder lookup returned a null path",
                operation,
            ));
        }
        let Some(recent_folder) = wide_ptr_to_string(path) else {
            unsafe {
                CoTaskMemFree(path.cast());
            }
            return Err(HostProtocolError::internal(
                "Windows Recent Items folder path was not valid UTF-16",
                operation,
            ));
        };
        unsafe {
            CoTaskMemFree(path.cast());
        }
        Ok(PathBuf::from(recent_folder))
    }

    fn recent_shortcuts(
        recent_folder: &Path,
        operation: &'static str,
    ) -> Result<Vec<RecentShortcut>, HostProtocolError> {
        let entries = std::fs::read_dir(recent_folder).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to read Windows Recent Items folder: {error}"),
                operation,
            )
        })?;
        let mut shortcuts = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to read a Windows Recent Items entry: {error}"),
                    operation,
                )
            })?;
            let path = entry.path();
            if !path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
            {
                continue;
            }
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            shortcuts.push(RecentShortcut { path, modified });
        }
        Ok(shortcuts)
    }

    fn resolve_shortcut_target(
        shortcut_path: &Path,
        operation: &'static str,
    ) -> Result<Option<String>, HostProtocolError> {
        let mut shell_link = std::ptr::null_mut();
        let result = unsafe {
            CoCreateInstance(
                &CLSID_SHELL_LINK,
                std::ptr::null_mut(),
                CLSCTX_INPROC_SERVER,
                &IID_ISHELL_LINK_W,
                &mut shell_link,
            )
        };
        if failed(result) {
            return Err(hresult_error(
                "failed to create Windows Shell Link resolver",
                result,
                operation,
            ));
        }
        let shell_link =
            ComInterface::from_raw(shell_link, "Windows Shell Link resolver", operation)?;
        let persist_file =
            query_interface(&shell_link, &IID_IPERSIST_FILE, "IPersistFile", operation)?;
        let shortcut_path = shortcut_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let persist_vtable = unsafe { *(persist_file.as_ptr() as *mut *const IPersistFileVTable) };
        let result = unsafe {
            ((*persist_vtable).load)(persist_file.as_ptr(), shortcut_path.as_ptr(), STGM_READ)
        };
        if failed(result) {
            return Ok(None);
        }

        let shell_link_vtable = unsafe { *(shell_link.as_ptr() as *mut *const IShellLinkWVTable) };
        let mut target = [0u16; WINDOWS_MAX_PATH];
        let result = unsafe {
            ((*shell_link_vtable).get_path)(
                shell_link.as_ptr(),
                target.as_mut_ptr(),
                WINDOWS_MAX_PATH as i32,
                std::ptr::null_mut(),
                0,
            )
        };
        if result == S_FALSE || failed(result) {
            return Ok(None);
        }
        Ok(wide_buffer_to_string(&target))
    }

    fn query_interface(
        interface: &ComInterface,
        iid: &GUID,
        name: &str,
        operation: &'static str,
    ) -> Result<ComInterface, HostProtocolError> {
        let mut output = std::ptr::null_mut();
        let vtable = unsafe { *(interface.as_ptr() as *mut *const IUnknown_Vtbl) };
        let result = unsafe { ((*vtable).QueryInterface)(interface.as_ptr(), iid, &mut output) };
        if failed(result) {
            return Err(hresult_error(
                &format!("failed to query Windows Shell Link {name}"),
                result,
                operation,
            ));
        }
        ComInterface::from_raw(output, name, operation)
    }

    fn wide_ptr_to_string(path: PWSTR) -> Option<String> {
        let mut length = 0usize;
        unsafe {
            while *path.add(length) != 0 {
                length += 1;
            }
            String::from_utf16(std::slice::from_raw_parts(path, length)).ok()
        }
    }

    fn wide_buffer_to_string(path: &[u16]) -> Option<String> {
        let length = path
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(path.len());
        if length == 0 {
            return None;
        }
        String::from_utf16(&path[..length]).ok()
    }

    fn failed(result: HRESULT) -> bool {
        result < 0
    }

    fn hresult_error(message: &str, result: HRESULT, operation: &'static str) -> HostProtocolError {
        HostProtocolError::internal(
            format!("{message}: HRESULT 0x{:08X}", result as u32),
            operation,
        )
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

    pub(super) fn list(operation: &'static str) -> Result<Vec<String>, HostProtocolError> {
        let mut documents = manager(operation)?
            .items()
            .into_iter()
            .filter_map(|item| {
                let visited = item.visited();
                let uri = item.uri()?;
                let (path, hostname) = gtk::glib::filename_from_uri(uri.as_str()).ok()?;
                if hostname.is_some() {
                    return None;
                }
                let path = path.into_os_string().into_string().ok()?;
                Some((visited, path))
            })
            .collect::<Vec<_>>();
        documents.sort_by(|left, right| right.0.cmp(&left.0));

        let mut paths = Vec::new();
        for (_, path) in documents {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
        Ok(paths)
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
