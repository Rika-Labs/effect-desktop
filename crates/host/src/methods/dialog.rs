#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use std::path::PathBuf;
#[cfg(target_os = "linux")]
use std::process::Command;

use host_protocol::{
    DialogConfirmPayload, DialogConfirmResultPayload, DialogFileFilterPayload, DialogLevelPayload,
    DialogMessagePayload, DialogOpenDirectoryPayload, DialogOpenFilePayload,
    DialogOpenResultPayload, DialogSaveFilePayload, DialogSaveResultPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn open_file(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    open_file_with(&NativeDialogAdapter, payload)
}

pub(crate) fn open_directory(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    open_directory_with(&NativeDialogAdapter, payload)
}

pub(crate) fn save_file(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    save_file_with(&NativeDialogAdapter, payload)
}

pub(crate) fn message(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    message_with(&NativeDialogAdapter, payload)
}

pub(crate) fn confirm(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    confirm_with(&NativeDialogAdapter, payload)
}

trait DialogAdapter {
    fn open_file(&self, input: &DialogOpenFilePayload) -> Result<Vec<PathBuf>, HostProtocolError>;
    fn open_directory(
        &self,
        input: &DialogOpenDirectoryPayload,
    ) -> Result<Vec<PathBuf>, HostProtocolError>;
    fn save_file(
        &self,
        input: &DialogSaveFilePayload,
    ) -> Result<Option<PathBuf>, HostProtocolError>;
    fn message(&self, input: &DialogMessagePayload) -> Result<(), HostProtocolError>;
    fn confirm(&self, input: &DialogConfirmPayload) -> Result<bool, HostProtocolError>;
}

struct NativeDialogAdapter;

impl DialogAdapter for NativeDialogAdapter {
    fn open_file(&self, input: &DialogOpenFilePayload) -> Result<Vec<PathBuf>, HostProtocolError> {
        #[cfg(target_os = "linux")]
        {
            zenity_file_selection(
                input,
                ZenitySelectionMode::File {
                    multiple: input.multiple(),
                },
                host_protocol::DIALOG_OPEN_FILE_METHOD,
            )
        }

        #[cfg(not(target_os = "linux"))]
        {
            let dialog = apply_file_dialog_options(rfd::FileDialog::new(), input);
            let paths = if input.multiple() {
                dialog.pick_files().unwrap_or_default()
            } else {
                dialog.pick_file().into_iter().collect()
            };
            Ok(paths)
        }
    }

    fn open_directory(
        &self,
        input: &DialogOpenDirectoryPayload,
    ) -> Result<Vec<PathBuf>, HostProtocolError> {
        #[cfg(target_os = "linux")]
        {
            zenity_file_selection(
                input,
                ZenitySelectionMode::Directory {
                    multiple: input.multiple(),
                },
                host_protocol::DIALOG_OPEN_DIRECTORY_METHOD,
            )
        }

        #[cfg(not(target_os = "linux"))]
        {
            let mut dialog = rfd::FileDialog::new();
            if let Some(title) = input.title() {
                dialog = dialog.set_title(title);
            }
            if let Some(default_path) = input.default_path() {
                dialog = dialog.set_directory(default_path);
            }

            let paths = if input.multiple() {
                dialog.pick_folders().unwrap_or_default()
            } else {
                dialog.pick_folder().into_iter().collect()
            };
            Ok(paths)
        }
    }

    fn save_file(
        &self,
        input: &DialogSaveFilePayload,
    ) -> Result<Option<PathBuf>, HostProtocolError> {
        #[cfg(target_os = "linux")]
        {
            zenity_save_file(input, host_protocol::DIALOG_SAVE_FILE_METHOD)
        }

        #[cfg(not(target_os = "linux"))]
        {
            let dialog = apply_file_dialog_options(rfd::FileDialog::new(), input);
            Ok(dialog.save_file())
        }
    }

    fn message(&self, input: &DialogMessagePayload) -> Result<(), HostProtocolError> {
        #[cfg(target_os = "linux")]
        {
            zenity_message(input, host_protocol::DIALOG_MESSAGE_METHOD)
        }

        #[cfg(not(target_os = "linux"))]
        {
            let _ = apply_message_dialog_options(rfd::MessageDialog::new(), input)
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            Ok(())
        }
    }

    fn confirm(&self, input: &DialogConfirmPayload) -> Result<bool, HostProtocolError> {
        #[cfg(target_os = "linux")]
        {
            zenity_confirm(input, host_protocol::DIALOG_CONFIRM_METHOD)
        }

        #[cfg(not(target_os = "linux"))]
        {
            let confirm_label = input.confirm_label().unwrap_or("OK");
            let buttons = match (input.confirm_label(), input.cancel_label()) {
                (Some(confirm), Some(cancel)) => {
                    rfd::MessageButtons::OkCancelCustom(confirm.to_string(), cancel.to_string())
                }
                (Some(confirm), None) => {
                    rfd::MessageButtons::OkCancelCustom(confirm.to_string(), "Cancel".to_string())
                }
                (None, Some(cancel)) => {
                    rfd::MessageButtons::OkCancelCustom("OK".to_string(), cancel.to_string())
                }
                _ => rfd::MessageButtons::OkCancel,
            };
            let result = apply_confirm_dialog_options(rfd::MessageDialog::new(), input)
                .set_buttons(buttons)
                .show();

            Ok(match result {
                rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes => true,
                rfd::MessageDialogResult::Custom(label) => label == confirm_label,
                _ => false,
            })
        }
    }
}

#[cfg(target_os = "linux")]
enum ZenitySelectionMode {
    File { multiple: bool },
    Directory { multiple: bool },
}

#[cfg(target_os = "linux")]
fn zenity_file_selection<T>(
    input: &T,
    mode: ZenitySelectionMode,
    operation: &'static str,
) -> Result<Vec<PathBuf>, HostProtocolError>
where
    T: FileDialogOptions,
{
    let multiple = match mode {
        ZenitySelectionMode::File { multiple } | ZenitySelectionMode::Directory { multiple } => {
            multiple
        }
    };
    reject_lossy_zenity_multi_selection(multiple, operation)?;

    let mut command = zenity_command();
    command.arg("--file-selection");
    if let ZenitySelectionMode::Directory { .. } = mode {
        command.arg("--directory");
    }
    apply_zenity_file_dialog_options(&mut command, input);
    Ok(selected_zenity_path(command, operation)?
        .into_iter()
        .collect())
}

#[cfg(target_os = "linux")]
fn zenity_save_file(
    input: &DialogSaveFilePayload,
    operation: &'static str,
) -> Result<Option<PathBuf>, HostProtocolError> {
    let mut command = zenity_command();
    command.args(["--file-selection", "--save", "--confirm-overwrite"]);
    apply_zenity_file_dialog_options(&mut command, input);
    selected_zenity_path(command, operation)
}

#[cfg(target_os = "linux")]
fn zenity_message(
    input: &DialogMessagePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut command = zenity_command();
    command.arg(match input.level() {
        DialogLevelPayload::Info => "--info",
        DialogLevelPayload::Warning => "--warning",
        DialogLevelPayload::Error => "--error",
    });
    apply_zenity_text_options(&mut command, input.title(), input.message(), input.detail());
    let _ = run_zenity(command, operation)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn zenity_confirm(
    input: &DialogConfirmPayload,
    operation: &'static str,
) -> Result<bool, HostProtocolError> {
    let mut command = zenity_command();
    command.arg("--question");
    apply_zenity_text_options(&mut command, input.title(), input.message(), input.detail());
    command.args(["--ok-label", input.confirm_label().unwrap_or("OK")]);
    command.args(["--cancel-label", input.cancel_label().unwrap_or("Cancel")]);
    match run_zenity(command, operation)? {
        ZenityOutcome::Accepted(_) => Ok(true),
        ZenityOutcome::Cancelled => Ok(false),
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn reject_lossy_zenity_multi_selection(
    multiple: bool,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if multiple {
        return Err(HostProtocolError::unsupported(
            "linux zenity multi-selection output is not lossless",
            operation,
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn apply_zenity_file_dialog_options<T>(command: &mut Command, input: &T)
where
    T: FileDialogOptions,
{
    if let Some(title) = input.title() {
        command.args(["--title", title]);
    }
    if let Some(default_path) = input.default_path() {
        command.args(["--filename", default_path]);
    }
    for filter in input.filters() {
        let extensions: Vec<String> = filter
            .extensions()
            .iter()
            .map(|extension| format!("*.{extension}"))
            .collect();
        command.args([
            "--file-filter",
            format!("{} | {}", filter.name(), extensions.join(" ")).as_str(),
        ]);
    }
}

#[cfg(target_os = "linux")]
fn apply_zenity_text_options(
    command: &mut Command,
    title: Option<&str>,
    message: &str,
    detail: Option<&str>,
) {
    let text = description(message, detail);
    command.args(["--no-markup", "--text", text.as_str()]);
    if let Some(title) = title {
        command.args(["--title", title]);
    }
}

#[cfg(target_os = "linux")]
enum ZenityOutcome {
    Accepted(String),
    Cancelled,
}

#[cfg(target_os = "linux")]
fn selected_zenity_path(
    command: Command,
    operation: &'static str,
) -> Result<Option<PathBuf>, HostProtocolError> {
    match run_zenity(command, operation)? {
        ZenityOutcome::Accepted(output) if output.is_empty() => Ok(None),
        ZenityOutcome::Accepted(output) => Ok(Some(PathBuf::from(output))),
        ZenityOutcome::Cancelled => Ok(None),
    }
}

#[cfg(target_os = "linux")]
fn zenity_command() -> Command {
    Command::new("zenity")
}

#[cfg(target_os = "linux")]
fn run_zenity(
    mut command: Command,
    operation: &'static str,
) -> Result<ZenityOutcome, HostProtocolError> {
    let output = command
        .output()
        .map_err(|_| HostProtocolError::host_unavailable(operation))?;
    if output.status.success() {
        let stdout = String::from_utf8(output.stdout).map_err(|_| {
            HostProtocolError::invalid_output(operation, "zenity stdout is not UTF-8")
        })?;
        return Ok(ZenityOutcome::Accepted(trim_zenity_stdout(stdout)));
    }
    if output.status.code() == Some(1) {
        return Ok(ZenityOutcome::Cancelled);
    }
    Err(HostProtocolError::host_unavailable(operation))
}

#[cfg(target_os = "linux")]
fn trim_zenity_stdout(mut value: String) -> String {
    if value.ends_with('\n') {
        value.pop();
    }
    value
}

fn open_file_with(
    adapter: &dyn DialogAdapter,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<DialogOpenFilePayload>(payload, host_protocol::DIALOG_OPEN_FILE_METHOD)?;
    validate_open_file(&input, host_protocol::DIALOG_OPEN_FILE_METHOD)?;
    let paths = encode_paths(
        adapter.open_file(&input)?,
        host_protocol::DIALOG_OPEN_FILE_METHOD,
    )?;
    encode_payload(
        DialogOpenResultPayload::new(paths),
        host_protocol::DIALOG_OPEN_FILE_METHOD,
    )
}

fn open_directory_with(
    adapter: &dyn DialogAdapter,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DialogOpenDirectoryPayload>(
        payload,
        host_protocol::DIALOG_OPEN_DIRECTORY_METHOD,
    )?;
    validate_open_directory(&input, host_protocol::DIALOG_OPEN_DIRECTORY_METHOD)?;
    let paths = encode_paths(
        adapter.open_directory(&input)?,
        host_protocol::DIALOG_OPEN_DIRECTORY_METHOD,
    )?;
    encode_payload(
        DialogOpenResultPayload::new(paths),
        host_protocol::DIALOG_OPEN_DIRECTORY_METHOD,
    )
}

fn save_file_with(
    adapter: &dyn DialogAdapter,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<DialogSaveFilePayload>(payload, host_protocol::DIALOG_SAVE_FILE_METHOD)?;
    validate_save_file(&input, host_protocol::DIALOG_SAVE_FILE_METHOD)?;
    let result = match adapter.save_file(&input)? {
        Some(path) => DialogSaveResultPayload::selected(encode_path(
            path,
            host_protocol::DIALOG_SAVE_FILE_METHOD,
        )?),
        None => DialogSaveResultPayload::canceled(),
    };
    encode_payload(result, host_protocol::DIALOG_SAVE_FILE_METHOD)
}

fn message_with(
    adapter: &dyn DialogAdapter,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<DialogMessagePayload>(payload, host_protocol::DIALOG_MESSAGE_METHOD)?;
    validate_message(&input, host_protocol::DIALOG_MESSAGE_METHOD)?;
    adapter.message(&input)?;
    Ok(None)
}

fn confirm_with(
    adapter: &dyn DialogAdapter,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<DialogConfirmPayload>(payload, host_protocol::DIALOG_CONFIRM_METHOD)?;
    validate_confirm(&input, host_protocol::DIALOG_CONFIRM_METHOD)?;
    encode_payload(
        DialogConfirmResultPayload::new(adapter.confirm(&input)?),
        host_protocol::DIALOG_CONFIRM_METHOD,
    )
}

fn apply_file_dialog_options<T>(mut dialog: rfd::FileDialog, input: &T) -> rfd::FileDialog
where
    T: FileDialogOptions,
{
    if let Some(title) = input.title() {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = input.default_path() {
        let path = PathBuf::from(default_path);
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        } else if let Some(parent) = path.parent() {
            dialog = dialog.set_directory(parent).set_file_name(
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(default_path),
            );
        } else {
            dialog = dialog.set_file_name(default_path);
        }
    }
    for filter in input.filters() {
        let extensions: Vec<&str> = filter.extensions().iter().map(String::as_str).collect();
        dialog = dialog.add_filter(filter.name(), &extensions);
    }
    dialog
}

fn apply_message_dialog_options(
    mut dialog: rfd::MessageDialog,
    input: &DialogMessagePayload,
) -> rfd::MessageDialog {
    dialog = dialog
        .set_level(message_level(input.level()))
        .set_description(description(input.message(), input.detail()));
    if let Some(title) = input.title() {
        dialog = dialog.set_title(title);
    }
    dialog
}

fn apply_confirm_dialog_options(
    mut dialog: rfd::MessageDialog,
    input: &DialogConfirmPayload,
) -> rfd::MessageDialog {
    dialog = dialog.set_description(description(input.message(), input.detail()));
    if let Some(title) = input.title() {
        dialog = dialog.set_title(title);
    }
    dialog
}

trait FileDialogOptions {
    fn title(&self) -> Option<&str>;
    fn default_path(&self) -> Option<&str>;
    fn filters(&self) -> &[DialogFileFilterPayload];
}

impl FileDialogOptions for DialogOpenFilePayload {
    fn title(&self) -> Option<&str> {
        self.title()
    }

    fn default_path(&self) -> Option<&str> {
        self.default_path()
    }

    fn filters(&self) -> &[DialogFileFilterPayload] {
        self.filters()
    }
}

impl FileDialogOptions for DialogOpenDirectoryPayload {
    fn title(&self) -> Option<&str> {
        self.title()
    }

    fn default_path(&self) -> Option<&str> {
        self.default_path()
    }

    fn filters(&self) -> &[DialogFileFilterPayload] {
        &[]
    }
}

impl FileDialogOptions for DialogSaveFilePayload {
    fn title(&self) -> Option<&str> {
        self.title()
    }

    fn default_path(&self) -> Option<&str> {
        self.default_path()
    }

    fn filters(&self) -> &[DialogFileFilterPayload] {
        self.filters()
    }
}

fn description(message: &str, detail: Option<&str>) -> String {
    match detail {
        Some(detail) => format!("{message}\n\n{detail}"),
        None => message.to_string(),
    }
}

fn message_level(level: DialogLevelPayload) -> rfd::MessageLevel {
    match level {
        DialogLevelPayload::Info => rfd::MessageLevel::Info,
        DialogLevelPayload::Warning => rfd::MessageLevel::Warning,
        DialogLevelPayload::Error => rfd::MessageLevel::Error,
    }
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let payload = payload.unwrap_or(Value::Object(Default::default()));
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
            format!("failed to encode dialog payload: {error}"),
            operation,
        )
    })
}

fn encode_paths(
    paths: Vec<PathBuf>,
    operation: &'static str,
) -> Result<Vec<String>, HostProtocolError> {
    paths
        .into_iter()
        .map(|path| encode_path(path, operation))
        .collect()
}

fn encode_path(path: PathBuf, operation: &'static str) -> Result<String, HostProtocolError> {
    let value = path
        .into_os_string()
        .into_string()
        .map_err(|_| HostProtocolError::invalid_output(operation, "path is not valid UTF-8"))?;
    if value.is_empty() || value.bytes().any(|byte| byte == 0) {
        return Err(HostProtocolError::invalid_output(
            operation,
            "path must be non-empty and must not contain NUL bytes",
        ));
    }
    Ok(value)
}

fn validate_open_file(
    input: &DialogOpenFilePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_optional_display_text(input.title(), "title", operation)?;
    validate_optional_default_path(input.default_path(), operation)?;
    validate_filters(input.filters(), operation)
}

fn validate_open_directory(
    input: &DialogOpenDirectoryPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_optional_display_text(input.title(), "title", operation)?;
    validate_optional_default_path(input.default_path(), operation)
}

fn validate_save_file(
    input: &DialogSaveFilePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_optional_display_text(input.title(), "title", operation)?;
    validate_optional_default_path(input.default_path(), operation)?;
    validate_filters(input.filters(), operation)
}

fn validate_message(
    input: &DialogMessagePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_optional_display_text(input.title(), "title", operation)?;
    validate_display_text(input.message(), "message", operation)?;
    validate_optional_display_text(input.detail(), "detail", operation)
}

fn validate_confirm(
    input: &DialogConfirmPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_optional_display_text(input.title(), "title", operation)?;
    validate_display_text(input.message(), "message", operation)?;
    validate_optional_display_text(input.detail(), "detail", operation)?;
    validate_optional_display_text(input.confirm_label(), "confirmLabel", operation)?;
    validate_optional_display_text(input.cancel_label(), "cancelLabel", operation)?;
    match (input.confirm_label(), input.cancel_label()) {
        (Some(confirm), Some(cancel)) if confirm == cancel => {
            Err(HostProtocolError::invalid_argument(
                "confirmLabel",
                "must differ from cancelLabel",
                operation,
            ))
        }
        _ => Ok(()),
    }
}

fn validate_optional_default_path(
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(value) = value {
        if value.bytes().any(|byte| byte == 0) {
            return Err(HostProtocolError::invalid_argument(
                "defaultPath",
                "must not contain NUL bytes",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_optional_display_text(
    value: Option<&str>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(value) = value {
        validate_display_text(value, field, operation)?;
    }
    Ok(())
}

fn validate_display_text(
    value: &str,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ));
    }
    if value.bytes().any(|byte| byte <= 0x1f || byte == 0x7f) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain ASCII control bytes",
            operation,
        ));
    }
    Ok(())
}

fn validate_filters(
    filters: &[DialogFileFilterPayload],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for filter in filters {
        validate_display_text(filter.name(), "filters.name", operation)?;
        if filter.extensions().is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "filters.extensions",
                "must not be empty",
                operation,
            ));
        }
        for extension in filter.extensions() {
            validate_extension(extension, operation)?;
        }
    }
    Ok(())
}

fn validate_extension(value: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if value.is_empty() || value.starts_with('*') {
        return Err(HostProtocolError::invalid_argument(
            "filters.extensions",
            "must be a non-empty extension without wildcard prefix",
            operation,
        ));
    }
    if value.bytes().any(|byte| byte <= 0x1f || byte == 0x7f) {
        return Err(HostProtocolError::invalid_argument(
            "filters.extensions",
            "must not contain ASCII control bytes",
            operation,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{confirm_with, message_with, open_directory_with, open_file_with, save_file_with};
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::path::PathBuf;

    struct TestDialogAdapter;

    struct FailingDialogAdapter;

    impl super::DialogAdapter for TestDialogAdapter {
        fn open_file(
            &self,
            input: &host_protocol::DialogOpenFilePayload,
        ) -> Result<Vec<PathBuf>, HostProtocolError> {
            assert!(input.multiple());
            Ok(vec![
                PathBuf::from("/tmp/a.txt"),
                PathBuf::from("/tmp/b.txt"),
            ])
        }

        fn open_directory(
            &self,
            _input: &host_protocol::DialogOpenDirectoryPayload,
        ) -> Result<Vec<PathBuf>, HostProtocolError> {
            Ok(Vec::new())
        }

        fn save_file(
            &self,
            input: &host_protocol::DialogSaveFilePayload,
        ) -> Result<Option<PathBuf>, HostProtocolError> {
            if input.default_path() == Some("/tmp/cancel.txt") {
                return Ok(None);
            }
            Ok(Some(PathBuf::from("/tmp/report.md")))
        }

        fn message(
            &self,
            _input: &host_protocol::DialogMessagePayload,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn confirm(
            &self,
            input: &host_protocol::DialogConfirmPayload,
        ) -> Result<bool, HostProtocolError> {
            Ok(input.confirm_label() == Some("Yes"))
        }
    }

    impl super::DialogAdapter for FailingDialogAdapter {
        fn open_file(
            &self,
            _input: &host_protocol::DialogOpenFilePayload,
        ) -> Result<Vec<PathBuf>, HostProtocolError> {
            Err(HostProtocolError::host_unavailable(
                host_protocol::DIALOG_OPEN_FILE_METHOD,
            ))
        }

        fn open_directory(
            &self,
            _input: &host_protocol::DialogOpenDirectoryPayload,
        ) -> Result<Vec<PathBuf>, HostProtocolError> {
            Err(HostProtocolError::host_unavailable(
                host_protocol::DIALOG_OPEN_DIRECTORY_METHOD,
            ))
        }

        fn save_file(
            &self,
            _input: &host_protocol::DialogSaveFilePayload,
        ) -> Result<Option<PathBuf>, HostProtocolError> {
            Err(HostProtocolError::host_unavailable(
                host_protocol::DIALOG_SAVE_FILE_METHOD,
            ))
        }

        fn message(
            &self,
            _input: &host_protocol::DialogMessagePayload,
        ) -> Result<(), HostProtocolError> {
            Err(HostProtocolError::host_unavailable(
                host_protocol::DIALOG_MESSAGE_METHOD,
            ))
        }

        fn confirm(
            &self,
            _input: &host_protocol::DialogConfirmPayload,
        ) -> Result<bool, HostProtocolError> {
            Err(HostProtocolError::host_unavailable(
                host_protocol::DIALOG_CONFIRM_METHOD,
            ))
        }
    }

    #[test]
    fn open_file_returns_selected_paths_as_data() {
        let payload = open_file_with(
            &TestDialogAdapter,
            Some(json!({
                "title": "Open",
                "defaultPath": "/tmp/input.txt",
                "filters": [{ "name": "Text", "extensions": ["txt"] }],
                "multiple": true
            })),
        )
        .expect("open file should succeed");

        assert_eq!(
            payload.expect("payload"),
            json!({ "paths": ["/tmp/a.txt", "/tmp/b.txt"] })
        );
    }

    #[test]
    fn open_directory_returns_cancellation_as_empty_paths() {
        let payload = open_directory_with(&TestDialogAdapter, Some(json!({})))
            .expect("open directory should succeed");

        assert_eq!(payload.expect("payload"), json!({ "paths": [] }));
    }

    #[test]
    fn save_file_returns_selection_and_cancellation_as_data() {
        let selected =
            save_file_with(&TestDialogAdapter, Some(json!({}))).expect("save file should succeed");
        assert_eq!(
            selected.expect("payload"),
            json!({ "path": "/tmp/report.md" })
        );

        let canceled = save_file_with(
            &TestDialogAdapter,
            Some(json!({ "defaultPath": "/tmp/cancel.txt" })),
        )
        .expect("save file cancellation should succeed");
        assert_eq!(canceled.expect("payload"), json!({}));
    }

    #[test]
    fn message_and_confirm_return_typed_results() {
        assert_eq!(
            message_with(
                &TestDialogAdapter,
                Some(json!({ "level": "info", "message": "Done" }))
            )
            .expect("message should succeed"),
            None
        );

        let confirmed = confirm_with(
            &TestDialogAdapter,
            Some(json!({ "message": "Proceed?", "confirmLabel": "Yes", "cancelLabel": "No" })),
        )
        .expect("confirm should succeed");
        assert_eq!(confirmed.expect("payload"), json!({ "confirmed": true }));
    }

    #[test]
    fn invalid_payload_rejects_before_adapter_runs() {
        assert_eq!(
            message_with(
                &TestDialogAdapter,
                Some(json!({ "level": "info", "message": "" }))
            )
            .expect_err("empty message should fail"),
            HostProtocolError::invalid_argument(
                "message",
                "must not be empty",
                host_protocol::DIALOG_MESSAGE_METHOD,
            )
        );

        assert_eq!(
            open_file_with(
                &TestDialogAdapter,
                Some(json!({ "filters": [{ "name": "Docs", "extensions": ["*.txt"] }] }))
            )
            .expect_err("wildcard extension should fail"),
            HostProtocolError::invalid_argument(
                "filters.extensions",
                "must be a non-empty extension without wildcard prefix",
                host_protocol::DIALOG_OPEN_FILE_METHOD,
            )
        );
    }

    #[test]
    fn adapter_failures_return_typed_host_errors() {
        let error =
            open_file_with(&FailingDialogAdapter, Some(json!({}))).expect_err("host should fail");

        assert_eq!(
            error,
            HostProtocolError::host_unavailable(host_protocol::DIALOG_OPEN_FILE_METHOD)
        );
    }

    #[test]
    fn linux_zenity_multi_selection_is_typed_unsupported() {
        assert_eq!(
            super::reject_lossy_zenity_multi_selection(
                true,
                host_protocol::DIALOG_OPEN_FILE_METHOD,
            )
            .expect_err("lossy multi-selection should fail"),
            HostProtocolError::unsupported(
                "linux zenity multi-selection output is not lossless",
                host_protocol::DIALOG_OPEN_FILE_METHOD,
            )
        );
    }
}
