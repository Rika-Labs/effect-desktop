use host_protocol::HostVersionPayload;
use serde_json::Value;

pub(crate) fn version_payload() -> Value {
    serde_json::to_value(HostVersionPayload::current())
        .expect("host version payload should serialize")
}
