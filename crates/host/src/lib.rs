pub const HOST_STARTED_EVENT: &str = "host.started";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StartupEvent {
    pub crate_name: &'static str,
    pub version: &'static str,
}

#[must_use]
pub fn startup_event() -> StartupEvent {
    StartupEvent {
        crate_name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
    }
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
