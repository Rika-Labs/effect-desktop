import { expect, test } from "bun:test"

test("empty native event side objects are not public API", async () => {
  const [
    crashReporterModule,
    dialogModule,
    dockModule,
    pathModule,
    protocolModule,
    safeStorageModule,
    shellModule,
    rootModule
  ] = await Promise.all([
    import("./crash-reporter.js"),
    import("./dialog.js"),
    import("./dock.js"),
    import("./path.js"),
    import("./protocol.js"),
    import("./safe-storage.js"),
    import("./shell.js"),
    import("./index.js")
  ])

  const moduleByRemovedName = {
    CrashReporterRpcEvents: crashReporterModule,
    DialogRpcEvents: dialogModule,
    DockRpcEvents: dockModule,
    PathRpcEvents: pathModule,
    ProtocolRpcEvents: protocolModule,
    SafeStorageRpcEvents: safeStorageModule,
    ShellRpcEvents: shellModule
  }

  for (const [removedName, ownerModule] of Object.entries(moduleByRemovedName)) {
    expect(removedName in ownerModule).toBe(false)
    expect(removedName in rootModule).toBe(false)
  }
})
