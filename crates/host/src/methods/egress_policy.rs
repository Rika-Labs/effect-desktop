#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    EgressPolicyActorPayload, EgressPolicyDecisionPayload, EgressPolicyDecisionResultPayload,
    EgressPolicyDestinationPayload, EgressPolicyOutcome, EgressPolicyRecordPayload,
    EgressPolicyRecordResultPayload, EgressPolicyRuleEffect, EgressPolicyRulePayload,
    EgressPolicySupportedPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

const DEFAULT_DENY_RULE_ID: &str = "default-deny";

pub(crate) fn decide(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<EgressPolicyDecisionPayload>(
        payload,
        host_protocol::EGRESS_POLICY_DECIDE_METHOD,
    )?;
    validate_decision(&input, host_protocol::EGRESS_POLICY_DECIDE_METHOD)?;
    let rule = default_deny_rule();
    let outcome = EgressPolicyOutcome::Denied;
    let reason = rule
        .reason()
        .map(str::to_string)
        .unwrap_or_else(|| "egress denied".to_string());
    let decision_id = input.trace_id().unwrap_or("egress-decision");

    encode_payload(
        EgressPolicyDecisionResultPayload::new(
            decision_id,
            outcome,
            input.actor().clone(),
            input.destination().clone(),
            rule,
            reason,
        ),
        host_protocol::EGRESS_POLICY_DECIDE_METHOD,
    )
}

pub(crate) fn record(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<EgressPolicyRecordPayload>(
        payload,
        host_protocol::EGRESS_POLICY_RECORD_METHOD,
    )?;
    validate_non_empty(
        "decisionId",
        input.decision_id(),
        host_protocol::EGRESS_POLICY_RECORD_METHOD,
    )?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty(
            "traceId",
            trace_id,
            host_protocol::EGRESS_POLICY_RECORD_METHOD,
        )?;
    }

    encode_payload(
        EgressPolicyRecordResultPayload::recorded(input.decision_id()),
        host_protocol::EGRESS_POLICY_RECORD_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        EgressPolicySupportedPayload::available(),
        host_protocol::EGRESS_POLICY_IS_SUPPORTED_METHOD,
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
            format!("failed to encode egress policy payload: {error}"),
            operation,
        )
    })
}

fn validate_decision(
    input: &EgressPolicyDecisionPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_destination(input.destination(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &EgressPolicyActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_destination(
    destination: &EgressPolicyDestinationPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("destination.host", destination.host(), operation)?;
    if destination.port() == Some(0) {
        return Err(HostProtocolError::invalid_argument(
            "destination.port",
            "must be between 1 and 65535",
            operation,
        ));
    }
    if let Some(path) = destination.path() {
        validate_no_nul("destination.path", path, operation)?;
    }
    Ok(())
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_no_nul(field, value, operation)?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_printable_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_no_nul(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL",
            operation,
        ));
    }
    Ok(())
}

fn default_deny_rule() -> EgressPolicyRulePayload {
    EgressPolicyRulePayload::new(
        DEFAULT_DENY_RULE_ID,
        EgressPolicyRuleEffect::Deny,
        vec!["*".to_string()],
        Vec::new(),
        Vec::new(),
        Some("no matching egress allow rule".to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::{decide, record};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn decide_returns_default_deny_without_trusted_host_rules() {
        let response = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test",
                "port": 443
            },
            "traceId": "trace-egress"
        })))
        .expect("decision should succeed");

        assert_eq!(
            response,
            Some(json!({
                "decisionId": "trace-egress",
                "outcome": "denied",
                "actor": { "kind": "extension", "id": "extension-1" },
                "destination": {
                    "protocol": "https",
                    "host": "api.example.test",
                    "port": 443
                },
                "rule": {
                    "id": "default-deny",
                    "effect": "deny",
                    "hosts": ["*"],
                    "reason": "no matching egress allow rule"
                },
                "reason": "no matching egress allow rule"
            }))
        );
    }

    #[test]
    fn decide_rejects_caller_supplied_rules() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test"
            },
            "rules": [
                {
                    "id": "allow-api",
                    "effect": "allow",
                    "hosts": ["api.example.test"]
                }
            ]
        })))
        .expect_err("caller supplied rules should fail closed");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "payload",
                "unknown field `rules`, expected one of `actor`, `destination`, `traceId`",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn decide_returns_default_deny() {
        let response = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "blocked.example.test"
            }
        })))
        .expect("decision should succeed");

        assert_eq!(
            response,
            Some(json!({
                "decisionId": "egress-decision",
                "outcome": "denied",
                "actor": { "kind": "extension", "id": "extension-1" },
                "destination": {
                    "protocol": "https",
                    "host": "blocked.example.test"
                },
                "rule": {
                    "id": "default-deny",
                    "effect": "deny",
                    "hosts": ["*"],
                    "reason": "no matching egress allow rule"
                },
                "reason": "no matching egress allow rule"
            }))
        );
    }

    #[test]
    fn decide_rejects_invalid_payload_before_policy_evaluation() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": ""
            }
        })))
        .expect_err("empty host should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "destination.host",
                "must be non-empty",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn decide_rejects_control_characters_in_printable_fields() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test\n"
            }
        })))
        .expect_err("control characters should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "destination.host",
                "must not include control characters",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn decide_rejects_zero_ports_before_policy_evaluation() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test",
                "port": 0
            }
        })))
        .expect_err("zero port should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "destination.port",
                "must be between 1 and 65535",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn record_returns_recorded_result_for_decoded_decisions() {
        let response = record(Some(json!({
            "decisionId": "decision-1",
            "traceId": "trace-record"
        })))
        .expect("record should succeed");

        assert_eq!(
            response,
            Some(json!({
                "decisionId": "decision-1",
                "recorded": true
            }))
        );
    }
}
