use anyhow::Result;
use host::{startup_event, HOST_STARTED_EVENT};
use tracing::info;

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
