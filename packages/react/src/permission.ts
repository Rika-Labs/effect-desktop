export interface PermissionState {
  readonly status: "deferred"
  readonly permission: string
}

export const usePermission = (permission: string): PermissionState => {
  if (permission.length === 0) {
    throw new RangeError("Permission identifier must be non-empty")
  }

  return {
    status: "deferred",
    permission
  }
}
