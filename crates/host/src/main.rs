use anyhow::Result;
use tracing::info;

const HOST_STARTED_EVENT: &str = "host.started";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StartupEvent {
    crate_name: &'static str,
    version: &'static str,
}

fn startup_event() -> StartupEvent {
    StartupEvent {
        crate_name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
    }
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .try_init()
        .map_err(|error| anyhow::anyhow!("failed to initialize tracing subscriber: {error}"))?;

    let event = startup_event();
    info!(
        event = HOST_STARTED_EVENT,
        crate = event.crate_name,
        version = event.version,
        "host started"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{startup_event, HOST_STARTED_EVENT};

    #[test]
    fn startup_event_identifies_host_binary() {
        let event = startup_event();

        assert_eq!(HOST_STARTED_EVENT, "host.started");
        assert_eq!(event.crate_name, "host");
        assert_eq!(event.version, "0.0.0");
    }
}
