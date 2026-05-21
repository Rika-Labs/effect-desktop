#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    BuildStreamError, DefaultStreamConfigError, PlayStreamError, SampleFormat,
};
use host_protocol::{
    HostProtocolEnvelope, HostProtocolError, RealtimeMediaDeviceKind,
    RealtimeMediaDeviceStateEventPayload, RealtimeMediaDeviceStatePayload,
    RealtimeMediaInterruptionEventPayload, RealtimeMediaInterruptionReason,
    RealtimeMediaPermissionState, RealtimeMediaPermissionStateEventPayload,
    RealtimeMediaSessionIdentityPayload, RealtimeMediaSessionInterruptPayload,
    RealtimeMediaSessionSelectDevicePayload, RealtimeMediaSessionState,
    RealtimeMediaSessionStateEventPayload, RealtimeMediaSessionSupportedPayload,
    REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON,
    REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::collections::HashMap;
use std::sync::{mpsc::Sender, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const SESSION_LIMIT: usize = 1024;
type StreamErrorHandler = Box<dyn Fn() + Send + 'static>;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct SessionKey {
    profile_id: String,
    session_id: String,
}

struct MediaSession {
    owner_window_id: Option<String>,
    request_id: Option<String>,
    trace_id: String,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
    selected_microphone: String,
    selected_speaker: String,
    input_stream: Option<cpal::Stream>,
    output_stream: Option<cpal::Stream>,
}

#[derive(Clone, Debug, PartialEq)]
struct HostMediaDevice {
    kind: RealtimeMediaDeviceKind,
    device_id: String,
    label: String,
    available: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct MediaSnapshot {
    devices: Vec<HostMediaDevice>,
    default_microphone: Option<String>,
    default_speaker: Option<String>,
}

trait MediaBackend {
    fn snapshot(&self, operation: &'static str) -> Result<MediaSnapshot, HostProtocolError>;

    fn build_input_stream(
        &self,
        device_id: &str,
        operation: &'static str,
        on_error: StreamErrorHandler,
    ) -> Result<Option<cpal::Stream>, HostProtocolError>;

    fn build_output_stream(
        &self,
        device_id: &str,
        operation: &'static str,
        on_error: StreamErrorHandler,
    ) -> Result<Option<cpal::Stream>, HostProtocolError>;
}

struct CpalMediaBackend;

static SESSIONS: OnceLock<Mutex<HashMap<SessionKey, MediaSession>>> = OnceLock::new();

pub(crate) type EventPayload = (&'static str, Value);
pub(crate) type EventfulResponse = Result<(Option<Value>, Vec<EventPayload>), HostProtocolError>;

pub(crate) fn open_with_events(
    request_id: &str,
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
    failure_sender: Option<Sender<SessionKey>>,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionIdentityPayload>(
        payload.clone(),
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
    )?;
    ensure_startup_can_be_verified(host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD)?;
    open_with_backend(
        payload,
        timestamp,
        owner_window_id,
        Some(request_id),
        event_sender,
        failure_sender,
        &CpalMediaBackend,
    )
}

pub(crate) fn close_with_events(
    _request_id: &str,
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
    _event_sender: Option<Sender<HostProtocolEnvelope>>,
    _failure_sender: Option<Sender<SessionKey>>,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionIdentityPayload>(
        payload.clone(),
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
    )?;
    ensure_startup_can_be_verified(host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD)?;
    close_with_backend(payload, timestamp, owner_window_id)
}

pub(crate) fn select_device_with_events(
    _request_id: &str,
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
    _event_sender: Option<Sender<HostProtocolEnvelope>>,
    failure_sender: Option<Sender<SessionKey>>,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionSelectDevicePayload>(
        payload.clone(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    validate_non_empty(
        "deviceId",
        input.device_id(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    ensure_startup_can_be_verified(host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD)?;
    select_device_with_backend(
        payload,
        timestamp,
        owner_window_id,
        failure_sender,
        &CpalMediaBackend,
    )
}

pub(crate) fn interrupt_with_events(
    _request_id: &str,
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
    _event_sender: Option<Sender<HostProtocolEnvelope>>,
    _failure_sender: Option<Sender<SessionKey>>,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionInterruptPayload>(
        payload.clone(),
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
    )?;
    ensure_startup_can_be_verified(host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD)?;
    interrupt_with_backend(payload, timestamp, owner_window_id)
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    let supported = is_supported_with_backend(&CpalMediaBackend);
    encode_payload(
        supported,
        host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD,
    )
}

fn is_supported_with_backend(backend: &impl MediaBackend) -> RealtimeMediaSessionSupportedPayload {
    let operation = host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD;
    if !cpal_reports_stream_start_synchronously() {
        return RealtimeMediaSessionSupportedPayload::unsupported(
            REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON,
        );
    }
    match backend.snapshot(operation) {
        Ok(snapshot) if snapshot.has_required_devices() => {
            let Some(microphone_id) = snapshot.default_microphone.as_deref() else {
                return RealtimeMediaSessionSupportedPayload::unsupported(
                    REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON,
                );
            };
            let Some(speaker_id) = snapshot.default_speaker.as_deref() else {
                return RealtimeMediaSessionSupportedPayload::unsupported(
                    REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON,
                );
            };
            if backend
                .build_input_stream(microphone_id, operation, Box::new(|| {}))
                .and_then(|stream| play_optional_stream(stream.as_ref(), operation))
                .is_ok()
                && backend
                    .build_output_stream(speaker_id, operation, Box::new(|| {}))
                    .and_then(|stream| play_optional_stream(stream.as_ref(), operation))
                    .is_ok()
            {
                RealtimeMediaSessionSupportedPayload::available()
            } else {
                RealtimeMediaSessionSupportedPayload::unsupported(
                    REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON,
                )
            }
        }
        Ok(_) | Err(_) => RealtimeMediaSessionSupportedPayload::unsupported(
            REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON,
        ),
    }
}

fn open_with_backend(
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
    request_id: Option<&str>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
    failure_sender: Option<Sender<SessionKey>>,
    backend: &impl MediaBackend,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionIdentityPayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
    )?;
    let key = SessionKey::new(input.profile_id(), input.session_id());
    {
        let sessions = sessions(host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD)?;
        if sessions.contains_key(&key) {
            return Err(already_exists(
                key.resource_name(),
                host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
            ));
        }
        if sessions.len() >= SESSION_LIMIT {
            return Err(HostProtocolError::internal(
                "realtime media session registry is full",
                host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
            ));
        }
    }

    let snapshot = backend.snapshot(host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD)?;
    let microphone_id = snapshot
        .default_microphone
        .clone()
        .ok_or_else(|| unavailable(host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD))?;
    let speaker_id = snapshot
        .default_speaker
        .clone()
        .ok_or_else(|| unavailable(host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD))?;
    let input_stream = backend.build_input_stream(
        &microphone_id,
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
        session_error_handler(key.clone(), failure_sender.clone()),
    )?;
    let output_stream = backend.build_output_stream(
        &speaker_id,
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
        session_error_handler(key.clone(), failure_sender),
    )?;

    {
        let mut sessions = sessions(host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD)?;
        if sessions.contains_key(&key) {
            return Err(already_exists(
                key.resource_name(),
                host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
            ));
        }
        if sessions.len() >= SESSION_LIMIT {
            return Err(HostProtocolError::internal(
                "realtime media session registry is full",
                host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
            ));
        }
        sessions.insert(
            key.clone(),
            MediaSession {
                owner_window_id: owner_window_id.map(str::to_string),
                request_id: request_id.map(str::to_string),
                trace_id: key.resource_name(),
                event_sender,
                selected_microphone: microphone_id.clone(),
                selected_speaker: speaker_id.clone(),
                input_stream,
                output_stream,
            },
        );
    }
    if let Err(error) =
        play_session_streams(&key, host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD)
    {
        let _ = remove_session(&key, host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD);
        return Err(error);
    }

    let events = vec![
        encode_event(
            host_protocol::REALTIME_MEDIA_SESSION_PERMISSION_STATE_EVENT,
            RealtimeMediaPermissionStateEventPayload::new(
                key.profile_id.clone(),
                key.session_id.clone(),
                RealtimeMediaPermissionState::Granted,
                RealtimeMediaPermissionState::Granted,
            ),
            timestamp,
        )?,
        encode_event(
            host_protocol::REALTIME_MEDIA_SESSION_DEVICE_STATE_EVENT,
            RealtimeMediaDeviceStateEventPayload::new(
                key.profile_id.clone(),
                key.session_id.clone(),
                selected_devices(&snapshot.devices, &microphone_id, &speaker_id),
            ),
            timestamp,
        )?,
        encode_event(
            host_protocol::REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT,
            RealtimeMediaSessionStateEventPayload::new(
                key.profile_id,
                key.session_id,
                RealtimeMediaSessionState::Active,
            ),
            timestamp,
        )?,
    ];
    Ok((None, events))
}

fn close_with_backend(
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionIdentityPayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
    )?;
    let key = SessionKey::new(input.profile_id(), input.session_id());
    let _removed = {
        let mut sessions = sessions(host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD)?;
        let session = sessions
            .get(&key)
            .ok_or_else(|| not_found(&key, host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD))?;
        validate_owner(
            session,
            owner_window_id,
            &key,
            host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
        )?;
        sessions
            .remove(&key)
            .expect("session should exist after close ownership validation")
    };

    let event = encode_event(
        host_protocol::REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT,
        RealtimeMediaSessionStateEventPayload::new(
            key.profile_id,
            key.session_id,
            RealtimeMediaSessionState::Closed,
        ),
        timestamp,
    )?;
    Ok((None, vec![event]))
}

fn select_device_with_backend(
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
    failure_sender: Option<Sender<SessionKey>>,
    backend: &impl MediaBackend,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionSelectDevicePayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;
    validate_non_empty(
        "deviceId",
        input.device_id(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    )?;

    let snapshot = backend.snapshot(host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD)?;
    if !snapshot.contains(input.kind(), input.device_id()) {
        return Err(HostProtocolError::not_found(
            format!("{:?}:{}", input.kind(), input.device_id()),
            host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
        ));
    }

    let key = SessionKey::new(input.profile_id(), input.session_id());
    {
        let sessions = sessions(host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD)?;
        let session = sessions.get(&key).ok_or_else(|| {
            not_found(
                &key,
                host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
            )
        })?;
        validate_owner(
            session,
            owner_window_id,
            &key,
            host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
        )?;
    }

    let input_stream = match input.kind() {
        RealtimeMediaDeviceKind::Microphone => Some(backend.build_input_stream(
            input.device_id(),
            host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
            session_error_handler(key.clone(), failure_sender.clone()),
        )?),
        RealtimeMediaDeviceKind::Speaker => None,
    };
    let output_stream = match input.kind() {
        RealtimeMediaDeviceKind::Microphone => None,
        RealtimeMediaDeviceKind::Speaker => Some(backend.build_output_stream(
            input.device_id(),
            host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
            session_error_handler(key.clone(), failure_sender),
        )?),
    };
    let mut replaced_input_stream = None;
    let mut replaced_output_stream = None;
    let (microphone_id, speaker_id) = {
        let mut sessions = sessions(host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD)?;
        let session = sessions.get_mut(&key).ok_or_else(|| {
            not_found(
                &key,
                host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
            )
        })?;
        match input.kind() {
            RealtimeMediaDeviceKind::Microphone => {
                replaced_input_stream = session.input_stream.take();
                session.input_stream = input_stream.expect("microphone selection opens input");
                session.selected_microphone = input.device_id().to_string();
            }
            RealtimeMediaDeviceKind::Speaker => {
                replaced_output_stream = session.output_stream.take();
                session.output_stream = output_stream.expect("speaker selection opens output");
                session.selected_speaker = input.device_id().to_string();
            }
        }
        (
            session.selected_microphone.clone(),
            session.selected_speaker.clone(),
        )
    };
    if let Err(error) = play_selected_stream(
        &key,
        input.kind(),
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
    ) {
        remove_session(
            &key,
            host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
        )?;
        return Err(error);
    }
    drop(replaced_input_stream);
    drop(replaced_output_stream);

    let event = encode_event(
        host_protocol::REALTIME_MEDIA_SESSION_DEVICE_STATE_EVENT,
        RealtimeMediaDeviceStateEventPayload::new(
            key.profile_id,
            key.session_id,
            selected_devices(&snapshot.devices, &microphone_id, &speaker_id),
        ),
        timestamp,
    )?;
    Ok((None, vec![event]))
}

fn interrupt_with_backend(
    payload: Option<Value>,
    timestamp: u64,
    owner_window_id: Option<&str>,
) -> EventfulResponse {
    let input = decode_payload::<RealtimeMediaSessionInterruptPayload>(
        payload,
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
    )?;
    validate_identity(
        input.profile_id(),
        input.session_id(),
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
    )?;
    let key = SessionKey::new(input.profile_id(), input.session_id());
    let (released_input_stream, released_output_stream) = {
        let mut sessions = sessions(host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD)?;
        let session = sessions.get_mut(&key).ok_or_else(|| {
            not_found(&key, host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD)
        })?;
        validate_owner(
            session,
            owner_window_id,
            &key,
            host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
        )?;
        (session.input_stream.take(), session.output_stream.take())
    };
    drop(released_input_stream);
    drop(released_output_stream);

    let events = vec![
        encode_event(
            host_protocol::REALTIME_MEDIA_SESSION_INTERRUPTION_EVENT,
            RealtimeMediaInterruptionEventPayload::new(
                key.profile_id.clone(),
                key.session_id.clone(),
                input.reason(),
            ),
            timestamp,
        )?,
        encode_event(
            host_protocol::REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT,
            RealtimeMediaSessionStateEventPayload::new(
                key.profile_id,
                key.session_id,
                RealtimeMediaSessionState::Interrupted,
            ),
            timestamp,
        )?,
    ];
    Ok((None, events))
}

impl SessionKey {
    fn new(profile_id: &str, session_id: &str) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            session_id: session_id.to_string(),
        }
    }

    fn resource_name(&self) -> String {
        format!(
            "RealtimeMediaSession:{}/{}",
            self.profile_id, self.session_id
        )
    }
}

fn ensure_startup_can_be_verified(operation: &'static str) -> Result<(), HostProtocolError> {
    if cpal_reports_stream_start_synchronously() {
        Ok(())
    } else {
        Err(HostProtocolError::unsupported(
            REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON,
            operation,
        ))
    }
}

impl MediaSnapshot {
    fn has_required_devices(&self) -> bool {
        self.default_microphone.is_some() && self.default_speaker.is_some()
    }

    fn contains(&self, kind: RealtimeMediaDeviceKind, device_id: &str) -> bool {
        self.devices
            .iter()
            .any(|device| device.kind == kind && device.device_id == device_id && device.available)
    }
}

fn validate_owner(
    session: &MediaSession,
    attempted_window_id: Option<&str>,
    key: &SessionKey,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(owner_window_id) = session.owner_window_id.as_deref() else {
        return Ok(());
    };
    if attempted_window_id == Some(owner_window_id) {
        return Ok(());
    }
    Err(HostProtocolError::CrossScopeHandle {
        kind: "RealtimeMediaSession".to_string(),
        id: key.resource_name(),
        owner_scope: owner_window_id.to_string(),
        attempted_scope: attempted_window_id.unwrap_or("runtime").to_string(),
        message: format!(
            "realtime media session {} belongs to window {owner_window_id}",
            key.resource_name()
        ),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("CrossScopeHandle").expect("known tag"),
        remediation: None,
        docs_url: None,
    })
}

fn cpal_reports_stream_start_synchronously() -> bool {
    cfg!(target_os = "macos")
}

impl MediaBackend for CpalMediaBackend {
    fn snapshot(&self, operation: &'static str) -> Result<MediaSnapshot, HostProtocolError> {
        let host = cpal::default_host();
        let default_microphone = host
            .default_input_device()
            .and_then(|device| device_id(&device, operation).ok());
        let default_speaker = host
            .default_output_device()
            .and_then(|device| device_id(&device, operation).ok());
        let mut devices = Vec::new();

        for device in host
            .input_devices()
            .map_err(|_error| unavailable(operation))?
        {
            let device_id = device_id(&device, operation)?;
            let label = device_label(&device).unwrap_or_else(|| device_id.clone());
            devices.push(HostMediaDevice {
                kind: RealtimeMediaDeviceKind::Microphone,
                available: true,
                device_id,
                label,
            });
        }
        for device in host
            .output_devices()
            .map_err(|_error| unavailable(operation))?
        {
            let device_id = device_id(&device, operation)?;
            let label = device_label(&device).unwrap_or_else(|| device_id.clone());
            devices.push(HostMediaDevice {
                kind: RealtimeMediaDeviceKind::Speaker,
                available: true,
                device_id,
                label,
            });
        }

        Ok(MediaSnapshot {
            devices,
            default_microphone,
            default_speaker,
        })
    }

    fn build_input_stream(
        &self,
        device_id: &str,
        operation: &'static str,
        on_error: StreamErrorHandler,
    ) -> Result<Option<cpal::Stream>, HostProtocolError> {
        let device = input_device_by_id(device_id, operation)?;
        let stream = build_input_stream(&device, operation, on_error)?;
        Ok(Some(stream))
    }

    fn build_output_stream(
        &self,
        device_id: &str,
        operation: &'static str,
        on_error: StreamErrorHandler,
    ) -> Result<Option<cpal::Stream>, HostProtocolError> {
        let device = output_device_by_id(device_id, operation)?;
        let stream = build_output_stream(&device, operation, on_error)?;
        Ok(Some(stream))
    }
}

fn play_optional_stream(
    stream: Option<&cpal::Stream>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(stream) = stream {
        stream
            .play()
            .map_err(|error| play_stream_error(operation, error))?;
    }
    Ok(())
}

fn play_session_streams(
    key: &SessionKey,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let sessions = sessions(operation)?;
    let session = sessions.get(key).ok_or_else(|| not_found(key, operation))?;
    play_optional_stream(session.input_stream.as_ref(), operation)?;
    play_optional_stream(session.output_stream.as_ref(), operation)
}

fn play_selected_stream(
    key: &SessionKey,
    kind: RealtimeMediaDeviceKind,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let sessions = sessions(operation)?;
    let session = sessions.get(key).ok_or_else(|| not_found(key, operation))?;
    match kind {
        RealtimeMediaDeviceKind::Microphone => {
            play_optional_stream(session.input_stream.as_ref(), operation)
        }
        RealtimeMediaDeviceKind::Speaker => {
            play_optional_stream(session.output_stream.as_ref(), operation)
        }
    }
}

fn remove_session(
    key: &SessionKey,
    operation: &'static str,
) -> Result<Option<MediaSession>, HostProtocolError> {
    Ok(sessions(operation)?.remove(key))
}

pub(crate) fn close_all_sessions(operation: &'static str) -> Result<(), HostProtocolError> {
    let dropped = {
        let mut sessions = sessions(operation)?;
        std::mem::take(&mut *sessions)
    };
    drop(dropped);
    Ok(())
}

pub(crate) fn close_sessions_for_window(
    window_id: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let dropped = {
        let mut sessions = sessions(operation)?;
        let keys = sessions
            .iter()
            .filter(|(_, session)| session.owner_window_id.as_deref() == Some(window_id))
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| sessions.remove(&key))
            .collect::<Vec<_>>()
    };
    drop(dropped);
    Ok(())
}

pub(crate) fn close_session_for_cancel(
    request_id: Option<&str>,
    resource_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let dropped = {
        let mut sessions = sessions(operation)?;
        let key = sessions.iter().find_map(|(key, session)| {
            let request_matches = request_id
                .is_some_and(|request_id| session.request_id.as_deref() == Some(request_id));
            let resource_matches =
                resource_id.is_some_and(|resource_id| key.resource_name() == resource_id);
            (request_matches || resource_matches).then(|| key.clone())
        });
        key.and_then(|key| sessions.remove(&key))
    };
    drop(dropped);
    Ok(())
}

fn input_device_by_id(
    device_id: &str,
    operation: &'static str,
) -> Result<cpal::Device, HostProtocolError> {
    device_by_id(device_id, RealtimeMediaDeviceKind::Microphone, operation)
}

fn output_device_by_id(
    device_id: &str,
    operation: &'static str,
) -> Result<cpal::Device, HostProtocolError> {
    device_by_id(device_id, RealtimeMediaDeviceKind::Speaker, operation)
}

fn device_by_id(
    device_id: &str,
    kind: RealtimeMediaDeviceKind,
    operation: &'static str,
) -> Result<cpal::Device, HostProtocolError> {
    let host = cpal::default_host();
    let parsed = device_id.parse::<cpal::DeviceId>().map_err(|error| {
        HostProtocolError::invalid_argument("deviceId", error.to_string(), operation)
    })?;
    host.device_by_id(&parsed)
        .ok_or_else(|| HostProtocolError::not_found(format!("{kind:?}:{device_id}"), operation))
}

fn build_input_stream(
    device: &cpal::Device,
    operation: &'static str,
    on_error: StreamErrorHandler,
) -> Result<cpal::Stream, HostProtocolError> {
    let supported = device
        .default_input_config()
        .map_err(|error| default_config_error(operation, error))?;
    let config = supported.config();
    match supported.sample_format() {
        SampleFormat::I8 => build_input_stream_for::<i8>(device, config, operation, on_error),
        SampleFormat::I16 => build_input_stream_for::<i16>(device, config, operation, on_error),
        SampleFormat::I24 => {
            build_input_stream_for::<cpal::I24>(device, config, operation, on_error)
        }
        SampleFormat::I32 => build_input_stream_for::<i32>(device, config, operation, on_error),
        SampleFormat::I64 => build_input_stream_for::<i64>(device, config, operation, on_error),
        SampleFormat::U8 => build_input_stream_for::<u8>(device, config, operation, on_error),
        SampleFormat::U16 => build_input_stream_for::<u16>(device, config, operation, on_error),
        SampleFormat::U24 => {
            build_input_stream_for::<cpal::U24>(device, config, operation, on_error)
        }
        SampleFormat::U32 => build_input_stream_for::<u32>(device, config, operation, on_error),
        SampleFormat::U64 => build_input_stream_for::<u64>(device, config, operation, on_error),
        SampleFormat::F32 => build_input_stream_for::<f32>(device, config, operation, on_error),
        SampleFormat::F64 => build_input_stream_for::<f64>(device, config, operation, on_error),
        SampleFormat::DsdU8 | SampleFormat::DsdU16 | SampleFormat::DsdU32 => Err(
            HostProtocolError::unsupported("host-media-sample-format-unsupported", operation),
        ),
        _ => Err(HostProtocolError::unsupported(
            "host-media-sample-format-unsupported",
            operation,
        )),
    }
}

fn build_input_stream_for<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    operation: &'static str,
    on_error: StreamErrorHandler,
) -> Result<cpal::Stream, HostProtocolError>
where
    T: cpal::SizedSample,
{
    device
        .build_input_stream(
            &config,
            |_data: &[T], _info: &cpal::InputCallbackInfo| {},
            move |error| {
                tracing::warn!(operation, error = %error, "realtime media input stream failed");
                on_error();
            },
            None,
        )
        .map_err(|error| build_stream_error("realtimeMediaSession.microphone", operation, error))
}

fn build_output_stream(
    device: &cpal::Device,
    operation: &'static str,
    on_error: StreamErrorHandler,
) -> Result<cpal::Stream, HostProtocolError> {
    let supported = device
        .default_output_config()
        .map_err(|error| default_config_error(operation, error))?;
    let config = supported.config();
    match supported.sample_format() {
        SampleFormat::I8 => build_output_stream_for::<i8>(device, config, operation, on_error),
        SampleFormat::I16 => build_output_stream_for::<i16>(device, config, operation, on_error),
        SampleFormat::I24 => {
            build_output_stream_for::<cpal::I24>(device, config, operation, on_error)
        }
        SampleFormat::I32 => build_output_stream_for::<i32>(device, config, operation, on_error),
        SampleFormat::I64 => build_output_stream_for::<i64>(device, config, operation, on_error),
        SampleFormat::U8 => build_output_stream_for::<u8>(device, config, operation, on_error),
        SampleFormat::U16 => build_output_stream_for::<u16>(device, config, operation, on_error),
        SampleFormat::U24 => {
            build_output_stream_for::<cpal::U24>(device, config, operation, on_error)
        }
        SampleFormat::U32 => build_output_stream_for::<u32>(device, config, operation, on_error),
        SampleFormat::U64 => build_output_stream_for::<u64>(device, config, operation, on_error),
        SampleFormat::F32 => build_output_stream_for::<f32>(device, config, operation, on_error),
        SampleFormat::F64 => build_output_stream_for::<f64>(device, config, operation, on_error),
        SampleFormat::DsdU8 | SampleFormat::DsdU16 | SampleFormat::DsdU32 => Err(
            HostProtocolError::unsupported("host-media-sample-format-unsupported", operation),
        ),
        _ => Err(HostProtocolError::unsupported(
            "host-media-sample-format-unsupported",
            operation,
        )),
    }
}

fn build_output_stream_for<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    operation: &'static str,
    on_error: StreamErrorHandler,
) -> Result<cpal::Stream, HostProtocolError>
where
    T: cpal::SizedSample + cpal::Sample,
{
    device
        .build_output_stream(
            &config,
            |data: &mut [T], _info: &cpal::OutputCallbackInfo| {
                for sample in data {
                    *sample = T::EQUILIBRIUM;
                }
            },
            move |error| {
                tracing::warn!(operation, error = %error, "realtime media output stream failed");
                on_error();
            },
            None,
        )
        .map_err(|error| build_stream_error("realtimeMediaSession.speaker", operation, error))
}

fn session_error_handler(
    key: SessionKey,
    failure_sender: Option<Sender<SessionKey>>,
) -> StreamErrorHandler {
    Box::new(move || {
        if let Some(sender) = failure_sender.as_ref() {
            let _ = sender.send(key.clone());
        }
    })
}

pub(crate) fn handle_session_failure(key: SessionKey) {
    let Some(session) = remove_failed_session(&key) else {
        return;
    };
    emit_session_failure_events(&key, session);
}

fn remove_failed_session(key: &SessionKey) -> Option<MediaSession> {
    let sessions = SESSIONS.get()?;
    sessions.lock().ok()?.remove(key)
}

fn emit_session_failure_events(key: &SessionKey, session: MediaSession) {
    let timestamp = timestamp_millis();
    let frames = [
        encode_async_event(
            host_protocol::REALTIME_MEDIA_SESSION_INTERRUPTION_EVENT,
            RealtimeMediaInterruptionEventPayload::new(
                key.profile_id.clone(),
                key.session_id.clone(),
                RealtimeMediaInterruptionReason::HostFailed,
            ),
            timestamp,
            &session,
        ),
        encode_async_event(
            host_protocol::REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT,
            RealtimeMediaSessionStateEventPayload::new(
                key.profile_id.clone(),
                key.session_id.clone(),
                RealtimeMediaSessionState::Closed,
            ),
            timestamp,
            &session,
        ),
    ];
    let Some(sender) = session.event_sender.as_ref() else {
        return;
    };
    for frame in frames.into_iter().flatten() {
        if sender.send(frame).is_err() {
            return;
        }
    }
}

fn encode_async_event<T: Serialize>(
    method: &'static str,
    payload: T,
    timestamp: u64,
    session: &MediaSession,
) -> Option<HostProtocolEnvelope> {
    Some(HostProtocolEnvelope::Event {
        method: method.to_string(),
        timestamp,
        trace_id: session.trace_id.clone(),
        window_id: session.owner_window_id.clone(),
        payload: Some(to_value(payload).ok()?),
    })
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_millis()
        .try_into()
        .expect("timestamp milliseconds should fit in u64")
}

fn device_id(device: &cpal::Device, operation: &'static str) -> Result<String, HostProtocolError> {
    device
        .id()
        .map(|id| id.to_string())
        .map_err(|_error| unavailable(operation))
}

fn device_label(device: &cpal::Device) -> Option<String> {
    device
        .description()
        .ok()
        .map(|description| description.name().to_string())
        .filter(|name| !name.is_empty())
}

fn selected_devices(
    devices: &[HostMediaDevice],
    microphone_id: &str,
    speaker_id: &str,
) -> Vec<RealtimeMediaDeviceStatePayload> {
    devices
        .iter()
        .map(|device| {
            RealtimeMediaDeviceStatePayload::new(
                device.kind,
                device.device_id.clone(),
                device.label.clone(),
                match device.kind {
                    RealtimeMediaDeviceKind::Microphone => device.device_id == microphone_id,
                    RealtimeMediaDeviceKind::Speaker => device.device_id == speaker_id,
                },
                device.available,
            )
        })
        .collect()
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
            format!("failed to encode realtime media session payload: {error}"),
            operation,
        )
    })
}

fn encode_event<T: Serialize>(
    method: &'static str,
    payload: T,
    _timestamp: u64,
) -> Result<EventPayload, HostProtocolError> {
    to_value(payload)
        .map(|value| (method, value))
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode realtime media session event payload: {error}"),
                method,
            )
        })
}

fn validate_identity(
    profile_id: &str,
    session_id: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("profileId", profile_id, operation)?;
    validate_non_empty("sessionId", session_id, operation)
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ))
    } else if value.as_bytes().contains(&0) {
        Err(HostProtocolError::invalid_argument(
            field,
            "must not include NUL bytes",
            operation,
        ))
    } else {
        Ok(())
    }
}

fn sessions(
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'static, HashMap<SessionKey, MediaSession>>, HostProtocolError> {
    SESSIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| HostProtocolError::internal("realtime media session lock poisoned", operation))
}

fn unavailable(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON, operation)
}

fn default_config_error(
    operation: &'static str,
    error: DefaultStreamConfigError,
) -> HostProtocolError {
    match error {
        DefaultStreamConfigError::BackendSpecific { ref err }
            if looks_like_permission_denied(&err.description) =>
        {
            permission_denied(
                "realtimeMediaSession.media",
                operation,
                err.description.clone(),
            )
        }
        _ => unavailable(operation),
    }
}

fn build_stream_error(
    capability: &'static str,
    operation: &'static str,
    error: BuildStreamError,
) -> HostProtocolError {
    match error {
        BuildStreamError::BackendSpecific { ref err }
            if looks_like_permission_denied(&err.description) =>
        {
            permission_denied(capability, operation, err.description.clone())
        }
        _ => unavailable(operation),
    }
}

fn play_stream_error(operation: &'static str, error: PlayStreamError) -> HostProtocolError {
    match error {
        PlayStreamError::BackendSpecific { ref err }
            if looks_like_permission_denied(&err.description) =>
        {
            permission_denied(
                "realtimeMediaSession.media",
                operation,
                err.description.clone(),
            )
        }
        _ => unavailable(operation),
    }
}

fn looks_like_permission_denied(description: &str) -> bool {
    let description = description.to_ascii_lowercase();
    description.contains("permission")
        || description.contains("denied")
        || description.contains("not authorized")
        || description.contains("unauthorized")
        || description.contains("privacy")
        || description.contains("access")
}

fn permission_denied(
    capability: &'static str,
    operation: &'static str,
    message: String,
) -> HostProtocolError {
    HostProtocolError::PermissionDenied {
        capability: capability.to_string(),
        resource: None,
        message,
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("PermissionDenied").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn not_found(key: &SessionKey, operation: &'static str) -> HostProtocolError {
    HostProtocolError::not_found(key.resource_name(), operation)
}

fn already_exists(resource: String, operation: &'static str) -> HostProtocolError {
    HostProtocolError::AlreadyExists {
        message: format!("resource already exists: {resource}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("AlreadyExists").expect("known tag"),
        remediation: None,
        docs_url: None,
        resource,
    }
}

#[cfg(test)]
pub(crate) fn clear_sessions_for_tests() {
    if let Some(sessions) = SESSIONS.get() {
        sessions
            .lock()
            .expect("realtime media session test lock should not be poisoned")
            .clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        close_all_sessions, close_session_for_cancel, close_sessions_for_window,
        close_with_backend, handle_session_failure, interrupt_with_backend,
        is_supported_with_backend, open_with_backend, select_device_with_backend,
        session_error_handler, HostMediaDevice, MediaBackend, MediaSnapshot, SessionKey,
    };
    use host_protocol::{HostProtocolEnvelope, HostProtocolError, RealtimeMediaDeviceKind};
    use serde_json::json;
    use std::cell::Cell;
    use std::sync::{mpsc, Mutex, MutexGuard, OnceLock};

    static TEST_SESSION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    struct FakeMediaBackend {
        snapshot: MediaSnapshot,
        open_calls: Cell<usize>,
        open_failure: bool,
    }

    impl MediaBackend for FakeMediaBackend {
        fn snapshot(&self, _operation: &'static str) -> Result<MediaSnapshot, HostProtocolError> {
            Ok(self.snapshot.clone())
        }

        fn build_input_stream(
            &self,
            _device_id: &str,
            operation: &'static str,
            _on_error: super::StreamErrorHandler,
        ) -> Result<Option<cpal::Stream>, HostProtocolError> {
            self.open_calls.set(self.open_calls.get() + 1);
            if self.open_failure {
                return Err(HostProtocolError::unsupported(
                    host_protocol::REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON,
                    operation,
                ));
            }
            Ok(None)
        }

        fn build_output_stream(
            &self,
            _device_id: &str,
            operation: &'static str,
            _on_error: super::StreamErrorHandler,
        ) -> Result<Option<cpal::Stream>, HostProtocolError> {
            self.open_calls.set(self.open_calls.get() + 1);
            if self.open_failure {
                return Err(HostProtocolError::unsupported(
                    host_protocol::REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON,
                    operation,
                ));
            }
            Ok(None)
        }
    }

    #[test]
    fn open_records_session_and_emits_permission_device_and_state_events() {
        let _sessions = isolated_sessions();
        let response = open_with_backend(
            Some(json!({
                "profileId": "profile-open",
                "sessionId": "session-open"
            })),
            1710000000000,
            None,
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("open should succeed");

        assert_eq!(response.0, None);
        assert_eq!(response.1.len(), 3);
        assert_eq!(
            response.1[0].0,
            host_protocol::REALTIME_MEDIA_SESSION_PERMISSION_STATE_EVENT
        );
        assert_eq!(
            response.1[1].0,
            host_protocol::REALTIME_MEDIA_SESSION_DEVICE_STATE_EVENT
        );
        assert_eq!(
            response.1[2].0,
            host_protocol::REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT
        );
    }

    #[test]
    fn open_rejects_duplicate_session() {
        let _sessions = isolated_sessions();
        let backend = fake_backend();
        let input = Some(json!({
            "profileId": "profile-duplicate",
            "sessionId": "session-duplicate"
        }));
        open_with_backend(input.clone(), 0, None, None, None, None, &backend)
            .expect("first open should succeed");
        let error = open_with_backend(input, 0, None, None, None, None, &backend)
            .expect_err("duplicate session should reject");

        assert_eq!(error.tag(), "AlreadyExists");
        assert_eq!(backend.open_calls.get(), 2);
    }

    #[test]
    fn open_rejects_invalid_identity_before_backend_probe() {
        let _sessions = isolated_sessions();
        let backend = fake_backend();
        let error = open_with_backend(
            Some(json!({
                "profileId": "profile\u{0000}invalid",
                "sessionId": "session-invalid"
            })),
            0,
            None,
            None,
            None,
            None,
            &backend,
        )
        .expect_err("invalid identity should reject");

        assert_eq!(error.tag(), "InvalidArgument");
        assert_eq!(backend.open_calls.get(), 0);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn host_open_rejects_startup_unverified_platforms() {
        let error = super::open_with_events(
            "request-platform",
            Some(json!({
                "profileId": "profile-platform",
                "sessionId": "session-platform"
            })),
            0,
            None,
            None,
            None,
        )
        .expect_err("unverified startup platforms should reject real host open");

        assert!(matches!(
            error,
            HostProtocolError::Unsupported {
                reason,
                ..
            } if reason == host_protocol::REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON
        ));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn host_select_device_rejects_startup_unverified_platforms() {
        let error = super::select_device_with_events(
            "request-platform",
            Some(json!({
                "profileId": "profile-platform",
                "sessionId": "session-platform",
                "kind": "microphone",
                "deviceId": "mic-platform"
            })),
            0,
            None,
            None,
            None,
        )
        .expect_err("unverified startup platforms should reject real host device selection");

        assert!(matches!(
            error,
            HostProtocolError::Unsupported {
                reason,
                ..
            } if reason == host_protocol::REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON
        ));
    }

    #[test]
    fn select_device_requires_open_session() {
        let _sessions = isolated_sessions();
        let error = select_device_with_backend(
            Some(json!({
                "profileId": "profile-missing",
                "sessionId": "session-missing",
                "kind": "microphone",
                "deviceId": "mic-1"
            })),
            0,
            None,
            None,
            &fake_backend(),
        )
        .expect_err("selecting before open should reject");

        assert_eq!(error.tag(), "NotFound");
    }

    #[test]
    fn select_device_updates_selected_device_event() {
        let _sessions = isolated_sessions();
        let backend = fake_backend();
        open_with_backend(
            Some(json!({
                "profileId": "profile-select",
                "sessionId": "session-select"
            })),
            0,
            None,
            None,
            None,
            None,
            &backend,
        )
        .expect("open should succeed");

        let response = select_device_with_backend(
            Some(json!({
                "profileId": "profile-select",
                "sessionId": "session-select",
                "kind": "microphone",
                "deviceId": "mic-2"
            })),
            0,
            None,
            None,
            &backend,
        )
        .expect("select should succeed");

        assert_eq!(response.1.len(), 1);
        assert_eq!(
            response.1[0].0,
            host_protocol::REALTIME_MEDIA_SESSION_DEVICE_STATE_EVENT
        );
        assert_eq!(response.1[0].1["devices"][1]["selected"], true);
    }

    #[test]
    fn select_speaker_opens_selected_output_path() {
        let _sessions = isolated_sessions();
        let backend = fake_backend();
        open_with_backend(
            Some(json!({
                "profileId": "profile-speaker",
                "sessionId": "session-speaker"
            })),
            0,
            None,
            None,
            None,
            None,
            &backend,
        )
        .expect("open should succeed");

        let response = select_device_with_backend(
            Some(json!({
                "profileId": "profile-speaker",
                "sessionId": "session-speaker",
                "kind": "speaker",
                "deviceId": "speaker-1"
            })),
            0,
            None,
            None,
            &backend,
        )
        .expect("speaker select should succeed");

        assert_eq!(backend.open_calls.get(), 3);
        assert_eq!(response.1[0].1["devices"][2]["selected"], true);
    }

    #[test]
    fn interrupt_emits_interruption_then_session_state() {
        let _sessions = isolated_sessions();
        open_with_backend(
            Some(json!({
                "profileId": "profile-interrupt",
                "sessionId": "session-interrupt"
            })),
            0,
            None,
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("open should succeed");

        let response = interrupt_with_backend(
            Some(json!({
                "profileId": "profile-interrupt",
                "sessionId": "session-interrupt",
                "reason": "device-lost"
            })),
            0,
            None,
        )
        .expect("interrupt should succeed");

        assert_eq!(response.1.len(), 2);
        assert_eq!(
            response.1[0].0,
            host_protocol::REALTIME_MEDIA_SESSION_INTERRUPTION_EVENT
        );
        assert_eq!(
            response.1[1].0,
            host_protocol::REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT
        );
    }

    #[test]
    fn close_drops_session_and_emits_closed_state() {
        let _sessions = isolated_sessions();
        open_with_backend(
            Some(json!({
                "profileId": "profile-close",
                "sessionId": "session-close"
            })),
            0,
            None,
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("open should succeed");

        let response = close_with_backend(
            Some(json!({
                "profileId": "profile-close",
                "sessionId": "session-close"
            })),
            0,
            None,
        )
        .expect("close should succeed");

        assert_eq!(response.1.len(), 1);
        assert_eq!(response.1[0].1["state"], "closed");
    }

    #[test]
    fn runtime_cleanup_drops_all_sessions() {
        let _sessions = isolated_sessions();
        open_with_backend(
            Some(json!({
                "profileId": "profile-runtime-cleanup",
                "sessionId": "session-runtime-cleanup"
            })),
            0,
            None,
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("open should succeed");

        close_all_sessions("host.runtime.disconnect").expect("runtime cleanup should succeed");
        let error = close_with_backend(
            Some(json!({
                "profileId": "profile-runtime-cleanup",
                "sessionId": "session-runtime-cleanup"
            })),
            0,
            None,
        )
        .expect_err("closed runtime session should be removed");

        assert_eq!(error.tag(), "NotFound");
    }

    #[test]
    fn cancel_by_open_request_id_drops_session() {
        let _sessions = isolated_sessions();
        open_with_backend(
            Some(json!({
                "profileId": "profile-cancel",
                "sessionId": "session-cancel"
            })),
            0,
            None,
            Some("request-cancel"),
            None,
            None,
            &fake_backend(),
        )
        .expect("open should succeed");

        close_session_for_cancel(Some("request-cancel"), None, "host.runtime.cancel")
            .expect("cancel should release session");
        let error = close_with_backend(
            Some(json!({
                "profileId": "profile-cancel",
                "sessionId": "session-cancel"
            })),
            0,
            None,
        )
        .expect_err("cancelled session should be removed");

        assert_eq!(error.tag(), "NotFound");
    }

    #[test]
    fn window_cleanup_drops_only_sessions_owned_by_that_window() {
        let _sessions = isolated_sessions();
        open_with_backend(
            Some(json!({
                "profileId": "profile-window",
                "sessionId": "session-window-1"
            })),
            0,
            Some("window-1"),
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("window-owned open should succeed");
        open_with_backend(
            Some(json!({
                "profileId": "profile-window",
                "sessionId": "session-window-2"
            })),
            0,
            Some("window-2"),
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("other window open should succeed");

        close_sessions_for_window("window-1", "Window.destroy")
            .expect("window cleanup should succeed");

        let removed = close_with_backend(
            Some(json!({
                "profileId": "profile-window",
                "sessionId": "session-window-1"
            })),
            0,
            None,
        )
        .expect_err("destroyed window session should be removed");
        let remaining = close_with_backend(
            Some(json!({
                "profileId": "profile-window",
                "sessionId": "session-window-2"
            })),
            0,
            Some("window-2"),
        );

        assert_eq!(removed.tag(), "NotFound");
        assert!(remaining.is_ok());
    }

    #[test]
    fn window_owned_sessions_reject_cross_window_control() {
        let _sessions = isolated_sessions();
        open_with_backend(
            Some(json!({
                "profileId": "profile-cross-window",
                "sessionId": "session-cross-window"
            })),
            0,
            Some("window-owner"),
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("window-owned open should succeed");

        let error = interrupt_with_backend(
            Some(json!({
                "profileId": "profile-cross-window",
                "sessionId": "session-cross-window",
                "reason": "background"
            })),
            0,
            Some("window-other"),
        )
        .expect_err("other window should not control session");
        let owner_close = close_with_backend(
            Some(json!({
                "profileId": "profile-cross-window",
                "sessionId": "session-cross-window"
            })),
            0,
            Some("window-owner"),
        );

        assert_eq!(error.tag(), "CrossScopeHandle");
        assert!(owner_close.is_ok());
    }

    #[test]
    fn stream_error_handler_drops_failed_session() {
        let _sessions = isolated_sessions();
        open_with_backend(
            Some(json!({
                "profileId": "profile-stream-error",
                "sessionId": "session-stream-error"
            })),
            0,
            None,
            None,
            None,
            None,
            &fake_backend(),
        )
        .expect("open should succeed");

        handle_session_failure(SessionKey::new(
            "profile-stream-error",
            "session-stream-error",
        ));
        let error = close_with_backend(
            Some(json!({
                "profileId": "profile-stream-error",
                "sessionId": "session-stream-error"
            })),
            0,
            None,
        )
        .expect_err("failed stream session should be removed");

        assert_eq!(error.tag(), "NotFound");
    }

    #[test]
    fn stream_error_handler_emits_host_failure_events() {
        let _sessions = isolated_sessions();
        let (events, received) = mpsc::channel();
        let (failures, received_failures) = mpsc::channel();
        open_with_backend(
            Some(json!({
                "profileId": "profile-stream-event",
                "sessionId": "session-stream-event"
            })),
            0,
            Some("window-stream-event"),
            None,
            Some(events),
            Some(failures.clone()),
            &fake_backend(),
        )
        .expect("open should succeed");

        session_error_handler(
            SessionKey::new("profile-stream-event", "session-stream-event"),
            Some(failures),
        )();
        handle_session_failure(
            received_failures
                .recv()
                .expect("stream failure should enqueue session key"),
        );

        let interruption = received
            .recv()
            .expect("interruption event should be emitted");
        let session = received
            .recv()
            .expect("session state event should be emitted");

        assert!(matches!(
            interruption,
            HostProtocolEnvelope::Event {
                method,
                payload: Some(payload),
                ..
            } if method == host_protocol::REALTIME_MEDIA_SESSION_INTERRUPTION_EVENT
                && payload["reason"] == "host-failed"
        ));
        assert!(matches!(
            session,
            HostProtocolEnvelope::Event {
                method,
                payload: Some(payload),
                ..
            } if method == host_protocol::REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT
                && payload["state"] == "closed"
        ));
    }

    #[test]
    fn support_check_opens_and_releases_default_media_paths() {
        let backend = fake_backend();
        let supported = is_supported_with_backend(&backend);

        if super::cpal_reports_stream_start_synchronously() {
            assert!(supported.supported());
            assert_eq!(supported.reason(), None);
            assert_eq!(backend.open_calls.get(), 2);
        } else {
            assert!(!supported.supported());
            assert_eq!(
                supported.reason(),
                Some(host_protocol::REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON)
            );
            assert_eq!(backend.open_calls.get(), 0);
            return;
        }

        let unavailable = fake_backend_with_probe_failure();
        let unsupported = is_supported_with_backend(&unavailable);

        assert!(!unsupported.supported());
        assert_eq!(
            unsupported.reason(),
            Some(host_protocol::REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON)
        );
        assert_eq!(unavailable.open_calls.get(), 1);
    }

    fn fake_backend() -> FakeMediaBackend {
        FakeMediaBackend {
            snapshot: MediaSnapshot {
                default_microphone: Some("mic-1".to_string()),
                default_speaker: Some("speaker-1".to_string()),
                devices: vec![
                    HostMediaDevice {
                        kind: RealtimeMediaDeviceKind::Microphone,
                        device_id: "mic-1".to_string(),
                        label: "Microphone 1".to_string(),
                        available: true,
                    },
                    HostMediaDevice {
                        kind: RealtimeMediaDeviceKind::Microphone,
                        device_id: "mic-2".to_string(),
                        label: "Microphone 2".to_string(),
                        available: true,
                    },
                    HostMediaDevice {
                        kind: RealtimeMediaDeviceKind::Speaker,
                        device_id: "speaker-1".to_string(),
                        label: "Speaker 1".to_string(),
                        available: true,
                    },
                ],
            },
            open_calls: Cell::new(0),
            open_failure: false,
        }
    }

    fn fake_backend_with_probe_failure() -> FakeMediaBackend {
        FakeMediaBackend {
            snapshot: fake_backend().snapshot,
            open_calls: Cell::new(0),
            open_failure: true,
        }
    }

    fn isolated_sessions() -> MutexGuard<'static, ()> {
        let guard = TEST_SESSION_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("realtime media session test lock should not be poisoned");
        super::clear_sessions_for_tests();
        guard
    }
}
